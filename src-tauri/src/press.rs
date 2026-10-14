//! The press: finds `opencode`, runs `opencode serve --stdio` for Folio with a
//! per-launch password and Folio-owned state, and reads or writes files in the
//! open book. The webview talks to the server itself, over HTTP with Basic auth.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Serialize)]
pub struct Detect {
    found: bool,
    path: Option<String>,
    /// The sidecar shipped inside Folio, rather than one found on the machine.
    bundled: bool,
}

#[derive(Serialize)]
pub struct Outcome {
    ok: bool,
    error: Option<String>,
}

/// A press someone else started: its url and password.
#[derive(Deserialize)]
pub struct AttachTo {
    url: String,
    password: String,
}

#[derive(Serialize)]
pub struct Attach {
    ok: bool,
    url: Option<String>,
    password: Option<String>,
    version: Option<String>,
    spawned: bool,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct Status {
    running: bool,
    spawned: bool,
    pid: Option<u32>,
}

struct Press {
    child: Child,
    /// Held open: `serve --stdio` exits when its stdin closes, so the press dies with Folio.
    #[allow(dead_code)]
    stdin: Option<ChildStdin>,
    url: String,
    password: String,
}

static PRESS: Mutex<Option<Press>> = Mutex::new(None);

const READY_TIMEOUT: Duration = Duration::from_secs(10);

pub fn detect() -> Detect {
    match find_binary() {
        Some((path, bundled)) => Detect {
            found: true,
            path: Some(path.display().to_string()),
            bundled,
        },
        None => Detect {
            found: false,
            path: None,
            bundled: false,
        },
    }
}

impl Outcome {
    pub fn failed(error: &str) -> Self {
        Outcome {
            ok: false,
            error: Some(error.to_string()),
        }
    }
}

pub fn install() -> Outcome {
    let status = Command::new("bash")
        .args(["-lc", "curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path"])
        .status();
    match status {
        Ok(code) if code.success() => Outcome { ok: true, error: None },
        Ok(code) => Outcome {
            ok: false,
            error: Some(format!("The installer exited with {code}.")),
        },
        Err(error) => Outcome {
            ok: false,
            error: Some(error.to_string()),
        },
    }
}

/// Attach to `attach` if given, else to Folio's own press, starting it once.
pub fn attach(data_dir: PathBuf, directory: Option<String>, attach: Option<AttachTo>) -> Attach {
    if let Some(target) = attach {
        return match probe(&target.url, &target.password) {
            Ok(version) => Attach::ready(target.url, target.password, version, false),
            Err(error) => Attach::failed(error),
        };
    }
    let mut guard = PRESS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(press) = guard.as_mut() {
        if matches!(press.child.try_wait(), Ok(None)) {
            let version = probe(&press.url, &press.password).ok().flatten();
            return Attach::ready(press.url.clone(), press.password.clone(), version, true);
        }
        *guard = None;
    }
    match spawn(&data_dir.join("press"), directory) {
        Ok(press) => {
            let version = probe(&press.url, &press.password).ok().flatten();
            let result = Attach::ready(press.url.clone(), press.password.clone(), version, true);
            *guard = Some(press);
            result
        }
        Err(error) => Attach::failed(error),
    }
}

pub fn status() -> Status {
    let mut guard = PRESS.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_mut() {
        Some(press) => {
            let running = matches!(press.child.try_wait(), Ok(None));
            Status {
                running,
                spawned: true,
                pid: running.then(|| press.child.id()),
            }
        }
        None => Status {
            running: false,
            spawned: false,
            pid: None,
        },
    }
}

/// Stop Folio's own press, if it started one.
pub fn stop() -> Outcome {
    let mut guard = PRESS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut press) = guard.take() {
        drop(press.stdin.take());
        let _ = press.child.kill();
        let _ = press.child.wait();
    }
    Outcome { ok: true, error: None }
}

pub fn write_file(directory: &str, path: &str, content: &str) -> Outcome {
    let result = resolve_inside(directory, path).and_then(|target| {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, content).map_err(|e| e.to_string())
    });
    match result {
        Ok(()) => Outcome { ok: true, error: None },
        Err(error) => Outcome {
            ok: false,
            error: Some(error),
        },
    }
}

/// Remove a file in the book (never a folder), through the same guard as a write.
/// A link inside the book is removed itself; one that leaves the book is refused.
pub fn remove_file(directory: &str, path: &str) -> Outcome {
    let result = resolve_inside(directory, path).and_then(|target| {
        let meta = target.symlink_metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            return Err(format!("{path} is a folder, not a file."));
        }
        std::fs::remove_file(&target).map_err(|e| e.to_string())
    });
    match result {
        Ok(()) => Outcome { ok: true, error: None },
        Err(error) => Outcome {
            ok: false,
            error: Some(error),
        },
    }
}

pub fn read_file(directory: &str, path: &str) -> Result<String, String> {
    let target = resolve_inside(directory, path)?;
    std::fs::read_to_string(target).map_err(|e| e.to_string())
}

impl Attach {
    fn ready(url: String, password: String, version: Option<String>, spawned: bool) -> Self {
        Attach {
            ok: true,
            url: Some(url),
            password: Some(password),
            version,
            spawned,
            error: None,
        }
    }

    pub fn failed(error: String) -> Self {
        Attach {
            ok: false,
            url: None,
            password: None,
            version: None,
            spawned: false,
            error: Some(error),
        }
    }
}

fn spawn(state: &Path, directory: Option<String>) -> Result<Press, String> {
    let (binary, _) = find_binary().ok_or_else(|| "opencode is not installed.".to_string())?;
    let password = random_password()?;
    let mut command = Command::new(binary);
    command
        .args(["serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"])
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Folio's press keeps its own sessions and keys; the user's config stays theirs.
    for (key, dir) in [("XDG_DATA_HOME", "data"), ("XDG_STATE_HOME", "state"), ("XDG_CACHE_HOME", "cache")] {
        let path = state.join(dir);
        std::fs::create_dir_all(&path).map_err(|e| format!("The press folder could not be made: {e}"))?;
        command.env(key, path);
    }
    command.current_dir(working_dir(state, directory)?);
    let mut child = command.spawn().map_err(|e| format!("The press would not start: {e}"))?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // Keep the last few lines of stderr for an error, and drain both pipes so the press never blocks.
    let tail = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = stderr {
        let tail = Arc::clone(&tail);
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut kept = tail.lock().unwrap_or_else(|e| e.into_inner());
                kept.push_str(&line);
                kept.push('\n');
                if kept.len() > 2000 {
                    let cut = kept.len() - 2000;
                    let cut = (cut..kept.len()).find(|i| kept.is_char_boundary(*i)).unwrap_or(0);
                    kept.drain(..cut);
                }
            }
        });
    }
    let (ready, wait) = mpsc::channel::<String>();
    if let Some(stdout) = stdout {
        thread::spawn(move || {
            let mut sent = false;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if !sent {
                    if let Some(url) = parse_ready(&line) {
                        sent = ready.send(url).is_ok();
                    }
                }
            }
        });
    }
    match wait.recv_timeout(READY_TIMEOUT) {
        Ok(url) => Ok(Press {
            child,
            stdin,
            url,
            password,
        }),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            // Give the reader a moment to collect what the press said on its way out.
            thread::sleep(Duration::from_millis(100));
            let said = tail.lock().unwrap_or_else(|e| e.into_inner()).trim().to_string();
            Err(if said.is_empty() {
                "The press did not say it was ready.".into()
            } else {
                format!("The press did not say it was ready. It said: {said}")
            })
        }
    }
}

/// Where the press runs: the book's folder when one is given, else the press's own
/// `cwd` folder under its state. A Folio opened from Finder runs in `/`, and a press
/// started there would answer location-free calls about `/`.
fn working_dir(state: &Path, directory: Option<String>) -> Result<PathBuf, String> {
    if let Some(dir) = directory.map(PathBuf::from).filter(|d| d.is_dir()) {
        return Ok(dir);
    }
    let own = state.join("cwd");
    std::fs::create_dir_all(&own).map_err(|e| format!("The press folder could not be made: {e}"))?;
    Ok(own)
}

/// The readiness line of `serve --stdio`: `{"url":"http://127.0.0.1:59661"}`.
fn parse_ready(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    let url = value.get("url")?.as_str()?;
    (url.starts_with("http://") || url.starts_with("https://")).then(|| url.to_string())
}

/// `GET /api/info` with the password: the version, or a sentence saying why not.
fn probe(url: &str, password: &str) -> Result<Option<String>, String> {
    let unreachable = || "The press could not be reached.".to_string();
    let rest = url.strip_prefix("http://").ok_or_else(|| "Folio attaches to a press over http on this machine.".to_string())?;
    let host = rest.split('/').next().unwrap_or(rest);
    let addr = host.to_socket_addrs().ok().and_then(|mut a| a.next()).ok_or_else(unreachable)?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).map_err(|_| unreachable())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let auth = base64(format!("opencode:{password}").as_bytes(), STANDARD, true);
    let request = format!("GET /api/info HTTP/1.1\r\nHost: {host}\r\nAuthorization: Basic {auth}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).map_err(|_| unreachable())?;
    let mut response = Vec::new();
    let _ = stream.read_to_end(&mut response);
    let text = String::from_utf8_lossy(&response);
    let status = text.split_whitespace().nth(1).and_then(|s| s.parse::<u16>().ok()).ok_or_else(unreachable)?;
    match status {
        200 => Ok(version_of(&text)),
        401 => Err("The press wants a different password.".into()),
        other => Err(format!("The press answered {other}.")),
    }
}

fn version_of(response: &str) -> Option<String> {
    let body = response.split("\r\n\r\n").nth(1)?;
    let start = body.find('{')?;
    let end = body.rfind('}')?;
    let value: serde_json::Value = serde_json::from_str(body.get(start..=end)?).ok()?;
    value.get("version")?.as_str().map(str::to_string)
}

/// The sidecar beside Folio first, then `FOLIO_OPENCODE_BIN`, `~/.opencode/bin/opencode`, and `opencode` on the PATH.
fn find_binary() -> Option<(PathBuf, bool)> {
    let name = if cfg!(windows) { "opencode-cli.exe" } else { "opencode-cli" };
    if let Some(dir) = std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)) {
        let sidecar = dir.join(name);
        if sidecar.is_file() {
            return Some((sidecar, true));
        }
    }
    if let Some(env) = std::env::var_os("FOLIO_OPENCODE_BIN") {
        let path = PathBuf::from(env);
        if path.is_file() {
            return Some((path, false));
        }
    }
    if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
        let path = PathBuf::from(home).join(".opencode/bin/opencode");
        if path.is_file() {
            return Some((path, false));
        }
    }
    let which = if cfg!(windows) { "where" } else { "which" };
    let output = Command::new(which).arg("opencode").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?.trim();
    (output.status.success() && !first.is_empty()).then(|| (PathBuf::from(first), false))
}

/// `path` inside the book at `directory`: relative, no `..`, and not through a link that leaves it.
fn resolve_inside(directory: &str, path: &str) -> Result<PathBuf, String> {
    let root = Path::new(directory);
    if !root.is_absolute() {
        return Err("The book's folder must be an absolute path.".into());
    }
    let relative = Path::new(path);
    if path.is_empty() || !relative.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err(format!("{path} is outside the book."));
    }
    let target = root.join(relative);
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    // The deepest part of the path that exists must still be inside the book.
    // `symlink_metadata` does not follow links, so a link to a missing target
    // counts as existing; canonicalizing it then fails, and it is refused.
    let mut existing = target.as_path();
    while existing.symlink_metadata().is_err() {
        existing = existing.parent().ok_or_else(|| format!("{path} is outside the book."))?;
    }
    let real = existing.canonicalize().map_err(|_| format!("{path} is outside the book."))?;
    if !real.starts_with(&root) {
        return Err(format!("{path} is outside the book."));
    }
    Ok(target)
}

/// 32 random bytes from the operating system, as url-safe base64 (43 characters).
fn random_password() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("No randomness for the press password: {e}"))?;
    Ok(base64(&bytes, URL_SAFE, false))
}

const STANDARD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_SAFE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

fn base64(bytes: &[u8], table: &[u8; 64], pad: bool) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        for i in 0..=chunk.len() {
            out.push(table[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
        if pad {
            out.push_str(&"=".repeat(3 - chunk.len()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_readiness_line() {
        assert_eq!(parse_ready(r#"{"url":"http://127.0.0.1:59661"}"#), Some("http://127.0.0.1:59661".into()));
        assert_eq!(parse_ready("  {\"url\":\"http://127.0.0.1:4096\"}\n"), Some("http://127.0.0.1:4096".into()));
        assert_eq!(parse_ready("server listening on http://127.0.0.1:4096"), None);
        assert_eq!(parse_ready(r#"{"level":"info"}"#), None);
        assert_eq!(parse_ready(r#"{"url":"file:///etc"}"#), None);
        assert_eq!(parse_ready(""), None);
    }

    #[test]
    fn keeps_paths_inside_the_book() {
        let book = std::env::temp_dir().join(format!("folio-press-test-{}", std::process::id()));
        std::fs::create_dir_all(book.join("src")).unwrap();
        let dir = book.to_str().unwrap();
        assert!(resolve_inside(dir, "src/greet.ts").is_ok());
        assert!(resolve_inside(dir, "new/deep/file.txt").is_ok());
        assert!(resolve_inside(dir, "./README.md").is_ok());
        assert!(resolve_inside(dir, "../outside.txt").is_err());
        assert!(resolve_inside(dir, "src/../../outside.txt").is_err());
        assert!(resolve_inside(dir, "/etc/passwd").is_err());
        assert!(resolve_inside(dir, "").is_err());
        assert!(resolve_inside("relative/book", "a.txt").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/tmp", book.join("away")).unwrap();
            assert!(resolve_inside(dir, "away/file.txt").is_err());
        }
        assert!(write_file(dir, "src/greet.ts", "hello\n").ok);
        assert_eq!(read_file(dir, "src/greet.ts").unwrap(), "hello\n");
        assert!(!write_file(dir, "../escape.txt", "x").ok);
        std::fs::remove_dir_all(&book).unwrap();
    }

    /// With no book given, the press runs in its own folder, not in Folio's working directory (`/` from Finder).
    #[test]
    fn runs_the_press_in_its_own_folder_without_a_book() {
        let state = std::env::temp_dir().join(format!("folio-press-cwd-{}", std::process::id()));
        let own = working_dir(&state, None).unwrap();
        assert_eq!(own, state.join("cwd"));
        assert!(own.is_dir());
        let book = state.join("book");
        std::fs::create_dir_all(&book).unwrap();
        assert_eq!(working_dir(&state, Some(book.display().to_string())).unwrap(), book);
        assert_eq!(working_dir(&state, Some(state.join("missing").display().to_string())).unwrap(), state.join("cwd"));
        std::fs::remove_dir_all(&state).unwrap();
    }

    /// Removing goes through the same guard as writing, and never takes a folder.
    #[test]
    fn removes_only_files_inside_the_book() {
        let base = std::env::temp_dir().join(format!("folio-press-remove-{}", std::process::id()));
        let book = base.join("book");
        let outside = base.join("outside");
        std::fs::create_dir_all(book.join("src")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep.txt"), "keep\n").unwrap();
        let dir = book.to_str().unwrap();
        assert!(write_file(dir, "src/new.ts", "x\n").ok);
        assert!(remove_file(dir, "src/new.ts").ok);
        assert!(!book.join("src/new.ts").exists());
        assert!(!remove_file(dir, "src").ok);
        assert!(book.join("src").is_dir());
        assert!(!remove_file(dir, "../outside/keep.txt").ok);
        assert!(!remove_file(dir, outside.join("keep.txt").to_str().unwrap()).ok);
        assert!(!remove_file(dir, "").ok);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, book.join("away")).unwrap();
            assert!(!remove_file(dir, "away/keep.txt").ok);
            std::os::unix::fs::symlink("../outside/keep.txt", book.join("link.txt")).unwrap();
            assert!(!remove_file(dir, "link.txt").ok);
            std::os::unix::fs::symlink("../outside/missing.txt", book.join("dangling.txt")).unwrap();
            assert!(!remove_file(dir, "dangling.txt").ok);
        }
        assert!(outside.join("keep.txt").exists());
        std::fs::remove_dir_all(&base).unwrap();
    }

    /// A link to a file that does not exist yet must not let a write create it outside the book.
    #[cfg(unix)]
    #[test]
    fn refuses_a_link_to_a_missing_file_outside_the_book() {
        let base = std::env::temp_dir().join(format!("folio-press-dangling-{}", std::process::id()));
        let book = base.join("book");
        let outside = base.join("outside");
        std::fs::create_dir_all(&book).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink("../outside/planted.txt", book.join("link.txt")).unwrap();
        std::os::unix::fs::symlink("../outside/missing-dir", book.join("gone")).unwrap();
        let dir = book.to_str().unwrap();
        assert!(resolve_inside(dir, "link.txt").is_err());
        assert!(resolve_inside(dir, "gone/file.txt").is_err());
        assert!(!write_file(dir, "link.txt", "planted\n").ok);
        assert!(!write_file(dir, "gone/file.txt", "planted\n").ok);
        assert!(!outside.join("planted.txt").exists());
        assert!(!outside.join("missing-dir").exists());
        // A link that stays inside the book still works.
        std::fs::write(book.join("real.txt"), "inside\n").unwrap();
        std::os::unix::fs::symlink("real.txt", book.join("alias.txt")).unwrap();
        assert!(resolve_inside(dir, "alias.txt").is_ok());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn makes_url_safe_passwords_and_basic_auth() {
        let a = random_password().unwrap();
        let b = random_password().unwrap();
        assert_eq!(a.len(), 43);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(base64(b"opencode:testpw123", STANDARD, true), "b3BlbmNvZGU6dGVzdHB3MTIz");
        assert_eq!(base64(b"ab", STANDARD, true), "YWI=");
        assert_eq!(base64(b"a", STANDARD, true), "YQ==");
    }

    #[test]
    fn reads_the_version_from_an_info_answer() {
        let answer = "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"version\":\"2.0.28\",\"pid\":1}";
        assert_eq!(version_of(answer), Some("2.0.28".into()));
        assert_eq!(version_of("HTTP/1.1 200 OK\r\n\r\nnot json"), None);
    }

    /// Starts the real press: `FOLIO_OPENCODE_BIN=… cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn starts_and_stops_a_real_press() {
        let state = std::env::temp_dir().join(format!("folio-press-live-{}", std::process::id()));
        let first = attach(state.clone(), None, None);
        assert!(first.ok, "{:?}", first.error);
        assert!(first.version.is_some());
        let again = attach(state.clone(), None, None);
        assert_eq!(again.url, first.url, "a live press is reused");
        let pid = status().pid.expect("running");
        assert!(state.join("press/data").is_dir());
        stop();
        assert!(!status().running);
        assert!(Command::new("kill").args(["-0", &pid.to_string()]).status().map(|s| !s.success()).unwrap_or(true));
        let _ = std::fs::remove_dir_all(state);
    }
}
