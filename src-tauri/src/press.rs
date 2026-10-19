//! The press: finds `opencode`, runs `opencode serve --stdio` for Folio with a
//! per-launch password and Folio-owned state, and reads or writes files in the
//! open book. The webview talks to the server itself, over HTTP with Basic auth.
//!
//! Locking: `attaching` serializes attaches, so two at once get the same press,
//! and it is held across the readiness wait. The slot lock is held only around
//! changes to the recorded press, so `stop` and `status` never wait behind a
//! press that is starting. `stop` bumps the slot's epoch; an attach that started
//! before it shuts its new press down instead of recording it.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

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
    /// Closing it is also how Folio asks the press to stop.
    stdin: Option<ChildStdin>,
    url: String,
    password: String,
}

struct Slot {
    press: Option<Press>,
    /// Bumped by every stop, so an attach that was starting a press knows it was stopped.
    epoch: u64,
}

/// How long a probe waits to connect, and then for the answer.
#[derive(Clone, Copy)]
struct Patience {
    connect: Duration,
    read: Duration,
}

/// For a press Folio has not talked to yet: a cold one can be slow to answer.
const FULL: Patience = Patience {
    connect: Duration::from_secs(3),
    read: Duration::from_secs(5),
};

/// For Folio's own press that should already be up: if it cannot answer this, it is hung.
const HEALTH: Patience = Patience {
    connect: Duration::from_secs(2),
    read: Duration::from_secs(4),
};

struct Presses {
    slot: Mutex<Slot>,
    attaching: Mutex<()>,
    health: Patience,
}

static PRESSES: Presses = Presses::new(HEALTH);

/// A cold first launch (a fresh sidecar, an empty cache) can take a while to say it is ready.
const READY_TIMEOUT: Duration = Duration::from_secs(30);

/// How long a stop waits for the press to leave on its own after its stdin closes.
pub const GRACE: Duration = Duration::from_millis(1500);

pub fn detect() -> Detect {
    match find_binary() {
        Some((path, bundled)) => Detect {
            found: true,
            path: Some(path.display().to_string()),
            bundled,
        },
        None => Detect::missing(),
    }
}

impl Detect {
    pub fn missing() -> Self {
        Detect {
            found: false,
            path: None,
            bundled: false,
        }
    }
}

impl Status {
    pub fn unknown() -> Self {
        Status {
            running: false,
            spawned: false,
            pid: None,
        }
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
        return match probe(&target.url, &target.password, FULL) {
            Ok(version) => Attach::ready(target.url, target.password, version, false),
            Err(error) => Attach::failed(error),
        };
    }
    PRESSES.own(|| spawn(&data_dir.join("press"), directory))
}

pub fn status() -> Status {
    PRESSES.status()
}

/// Stop Folio's own press, if it started one: close its stdin, wait up to `grace`, then kill.
pub fn stop(grace: Duration) -> Outcome {
    PRESSES.stop(grace);
    Outcome { ok: true, error: None }
}

impl Presses {
    const fn new(health: Patience) -> Self {
        Presses {
            slot: Mutex::new(Slot { press: None, epoch: 0 }),
            attaching: Mutex::new(()),
            health,
        }
    }

    fn slot(&self) -> MutexGuard<'_, Slot> {
        self.slot.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Folio's own press: the recorded one if it is alive and answers, else a new one from `start`.
    fn own(&self, start: impl FnOnce() -> Result<Press, String>) -> Attach {
        let _turn = self.attaching.lock().unwrap_or_else(|e| e.into_inner());
        let (current, epoch) = {
            let mut slot = self.slot();
            let alive = slot.press.as_mut().map(|press| matches!(press.child.try_wait(), Ok(None)));
            if alive == Some(false) {
                slot.press = None;
            }
            let current = slot
                .press
                .as_ref()
                .map(|press| (press.url.clone(), press.password.clone(), press.child.id()));
            (current, slot.epoch)
        };
        if let Some((url, password, pid)) = current {
            match probe(&url, &password, self.health) {
                Ok(version) => {
                    if self.slot().epoch != epoch {
                        return Attach::failed(STOPPED.into());
                    }
                    return Attach::ready(url, password, version, true);
                }
                Err(_) => {
                    // Alive but not answering: hung. Take it out (if it is still the one we probed) and kill it.
                    let hung = {
                        let mut slot = self.slot();
                        if slot.press.as_ref().map(|p| p.child.id()) == Some(pid) {
                            slot.press.take()
                        } else {
                            None
                        }
                    };
                    if let Some(press) = hung {
                        shutdown(press, Duration::ZERO);
                    }
                }
            }
        }
        let press = match start() {
            Ok(press) => press,
            Err(error) => return Attach::failed(error),
        };
        let version = probe(&press.url, &press.password, FULL).ok().flatten();
        let mut slot = self.slot();
        if slot.epoch != epoch {
            drop(slot);
            shutdown(press, Duration::ZERO);
            return Attach::failed(STOPPED.into());
        }
        let result = Attach::ready(press.url.clone(), press.password.clone(), version, true);
        slot.press = Some(press);
        result
    }

    fn status(&self) -> Status {
        let mut slot = self.slot();
        match slot.press.as_mut() {
            Some(press) => {
                let running = matches!(press.child.try_wait(), Ok(None));
                Status {
                    running,
                    spawned: true,
                    pid: running.then(|| press.child.id()),
                }
            }
            None => Status::unknown(),
        }
    }

    fn stop(&self, grace: Duration) {
        let press = {
            let mut slot = self.slot();
            slot.epoch += 1;
            slot.press.take()
        };
        if let Some(press) = press {
            shutdown(press, grace);
        }
    }
}

const STOPPED: &str = "The press was stopped while it was starting.";

#[derive(Debug, PartialEq, Eq)]
enum Step {
    Done,
    Wait,
    Kill,
}

/// While a press is stopping: gone is done, inside the grace period wait, after it kill.
fn next_step(exited: bool, waited: Duration, grace: Duration) -> Step {
    if exited {
        Step::Done
    } else if waited >= grace {
        Step::Kill
    } else {
        Step::Wait
    }
}

/// Close the press's stdin (`serve --stdio` treats that as "stop"), give it `grace`, then kill it.
fn shutdown(mut press: Press, grace: Duration) {
    drop(press.stdin.take());
    let started = Instant::now();
    loop {
        let exited = match press.child.try_wait() {
            Ok(Some(_)) => true,
            Ok(None) => false,
            Err(_) => break,
        };
        match next_step(exited, started.elapsed(), grace) {
            Step::Done => return,
            Step::Wait => thread::sleep(Duration::from_millis(20)),
            Step::Kill => break,
        }
    }
    let _ = press.child.kill();
    let _ = press.child.wait();
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
    let (drained, stderr_done) = mpsc::channel::<()>();
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
            let _ = drained.send(());
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
        Err(reason) => {
            let timed_out = matches!(reason, mpsc::RecvTimeoutError::Timeout);
            let _ = child.kill();
            let _ = child.wait();
            // Let the reader collect what the press said on its way out.
            let _ = stderr_done.recv_timeout(Duration::from_secs(1));
            let said = tail.lock().unwrap_or_else(|e| e.into_inner()).clone();
            Err(not_ready(timed_out, &said))
        }
    }
}

/// Why a press never said it was ready, with the tail of what it wrote to stderr.
fn not_ready(timed_out: bool, said: &str) -> String {
    let what = if timed_out {
        format!("The press did not say it was ready within {} seconds.", READY_TIMEOUT.as_secs())
    } else {
        "The press stopped before it said it was ready.".to_string()
    };
    match said.trim() {
        "" => what,
        said => format!("{what} It said: {said}"),
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

/// The first of `addrs` that accepts a connection, trying each (IPv4 and IPv6) in turn.
fn connect_any(addrs: impl IntoIterator<Item = SocketAddr>, timeout: Duration) -> Option<TcpStream> {
    addrs.into_iter().find_map(|addr| TcpStream::connect_timeout(&addr, timeout).ok())
}

/// `GET /api/info` with the password: the version, or a sentence saying why not.
fn probe(url: &str, password: &str, patience: Patience) -> Result<Option<String>, String> {
    let unreachable = || "The press could not be reached.".to_string();
    let rest = url.strip_prefix("http://").ok_or_else(|| "Folio attaches to a press over http on this machine.".to_string())?;
    let host = rest.split('/').next().unwrap_or(rest);
    let addrs = host.to_socket_addrs().map_err(|_| unreachable())?;
    let mut stream = connect_any(addrs, patience.connect).ok_or_else(unreachable)?;
    let _ = stream.set_read_timeout(Some(patience.read));
    let _ = stream.set_write_timeout(Some(patience.read));
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

    #[test]
    fn waits_out_the_grace_period_then_kills() {
        let grace = Duration::from_millis(1500);
        assert_eq!(next_step(true, Duration::ZERO, grace), Step::Done);
        assert_eq!(next_step(true, Duration::from_secs(5), grace), Step::Done);
        assert_eq!(next_step(false, Duration::ZERO, grace), Step::Wait);
        assert_eq!(next_step(false, Duration::from_millis(1499), grace), Step::Wait);
        assert_eq!(next_step(false, grace, grace), Step::Kill);
        assert_eq!(next_step(false, Duration::ZERO, Duration::ZERO), Step::Kill);
    }

    #[test]
    fn says_why_the_press_was_not_ready() {
        assert_eq!(not_ready(true, ""), "The press did not say it was ready within 30 seconds.");
        assert_eq!(not_ready(false, "  \n"), "The press stopped before it said it was ready.");
        assert_eq!(
            not_ready(false, "Error: port in use\n"),
            "The press stopped before it said it was ready. It said: Error: port in use"
        );
    }

    /// Every resolved address is tried, not only the first.
    #[test]
    fn tries_every_address() {
        // Port 0 never answers. A port freed by a dropped listener could be taken by a test
        // running alongside, which once made the "closed" address answer first.
        let closed = std::net::SocketAddr::from(([127, 0, 0, 1], 0));
        let open = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let good = open.local_addr().unwrap();
        let stream = connect_any([closed, good], Duration::from_secs(1)).expect("the second address answers");
        assert_eq!(stream.peer_addr().unwrap(), good);
        assert!(connect_any([closed], Duration::from_secs(1)).is_none());
        assert!(connect_any(Vec::new(), Duration::from_secs(1)).is_none());
        // IPv6 after a refused IPv4, when this machine has a loopback for it.
        if let Ok(six) = std::net::TcpListener::bind("[::1]:0") {
            let six_addr = six.local_addr().unwrap();
            let stream = connect_any([closed, six_addr], Duration::from_secs(1)).expect("IPv6 answers");
            assert_eq!(stream.peer_addr().unwrap(), six_addr);
        }
    }

    /// A stand-in press that answers every `/api/info` with 200.
    fn fake_info() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        thread::spawn(move || {
            for mut stream in listener.incoming().map_while(Result::ok) {
                let mut seen = Vec::new();
                let mut byte = [0u8; 1];
                while !seen.ends_with(b"\r\n\r\n") && stream.read(&mut byte).map(|n| n == 1).unwrap_or(false) {
                    seen.push(byte[0]);
                }
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{\"version\":\"test\"}");
            }
        });
        url
    }

    fn closed_url() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}", listener.local_addr().unwrap())
    }

    /// A child that leaves when its stdin closes, standing in for `serve --stdio`.
    #[cfg(unix)]
    fn fake_press(url: &str) -> Press {
        let mut child = Command::new("cat").stdin(Stdio::piped()).stdout(Stdio::null()).spawn().unwrap();
        let stdin = child.stdin.take();
        Press {
            child,
            stdin,
            url: url.to_string(),
            password: "pw".into(),
        }
    }

    #[cfg(unix)]
    fn gone(pid: u32) -> bool {
        Command::new("kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().map(|s| !s.success()).unwrap_or(true)
    }

    const QUICK: Patience = Patience {
        connect: Duration::from_millis(300),
        read: Duration::from_millis(300),
    };

    #[cfg(unix)]
    #[test]
    fn a_press_that_leaves_on_stdin_close_is_not_killed_late() {
        let started = Instant::now();
        shutdown(fake_press("http://127.0.0.1:1"), Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_secs(2), "cat leaves as soon as stdin closes");
    }

    #[cfg(unix)]
    #[test]
    fn a_press_that_ignores_stdin_is_killed_after_the_grace() {
        let mut child = Command::new("sleep").arg("30").stdin(Stdio::piped()).spawn().unwrap();
        let stdin = child.stdin.take();
        let pid = child.id();
        let press = Press { child, stdin, url: String::new(), password: String::new() };
        let started = Instant::now();
        shutdown(press, Duration::from_millis(300));
        let took = started.elapsed();
        assert!(took >= Duration::from_millis(300) && took < Duration::from_secs(3), "{took:?}");
        assert!(gone(pid));
    }

    /// Two attaches at once get the same press, started once.
    #[cfg(unix)]
    #[test]
    fn concurrent_attaches_share_one_press() {
        let presses = Presses::new(QUICK);
        let url = fake_info();
        let starts = std::sync::atomic::AtomicUsize::new(0);
        let start = || {
            starts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            thread::sleep(Duration::from_millis(300));
            Ok(fake_press(&url))
        };
        let (a, b) = thread::scope(|s| {
            let a = s.spawn(|| presses.own(start));
            let b = s.spawn(|| presses.own(start));
            (a.join().unwrap(), b.join().unwrap())
        });
        assert!(a.ok && b.ok, "{:?} {:?}", a.error, b.error);
        assert_eq!(a.url, b.url);
        assert_eq!(a.version.as_deref(), Some("test"));
        assert_eq!(starts.load(std::sync::atomic::Ordering::SeqCst), 1);
        presses.stop(GRACE);
    }

    /// Stop does not wait behind a press that is still starting, and that press is not kept.
    #[cfg(unix)]
    #[test]
    fn stop_does_not_wait_behind_a_starting_press() {
        let presses = Presses::new(QUICK);
        let url = fake_info();
        let pid = std::sync::atomic::AtomicU32::new(0);
        thread::scope(|s| {
            let starting = s.spawn(|| {
                presses.own(|| {
                    let press = fake_press(&url);
                    pid.store(press.child.id(), std::sync::atomic::Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(1500));
                    Ok(press)
                })
            });
            thread::sleep(Duration::from_millis(200));
            let asked = Instant::now();
            presses.stop(GRACE);
            assert!(asked.elapsed() < Duration::from_millis(500), "stop waited {:?}", asked.elapsed());
            let result = starting.join().unwrap();
            assert!(!result.ok);
            assert_eq!(result.error.as_deref(), Some(STOPPED));
        });
        assert!(!presses.status().spawned);
        assert!(gone(pid.load(std::sync::atomic::Ordering::SeqCst)));
    }

    /// A press that is alive but does not answer is killed and replaced.
    #[cfg(unix)]
    #[test]
    fn replaces_a_hung_press() {
        let presses = Presses::new(QUICK);
        let hung = fake_press(&closed_url());
        let hung_pid = hung.child.id();
        presses.slot().press = Some(hung);
        let url = fake_info();
        let result = presses.own(|| Ok(fake_press(&url)));
        assert!(result.ok, "{:?}", result.error);
        assert_eq!(result.url.as_deref(), Some(url.as_str()));
        assert!(gone(hung_pid));
        // A healthy press is kept on the next attach.
        let again = presses.own(|| Err("should not start another".into()));
        assert_eq!(again.url.as_deref(), Some(url.as_str()));
        presses.stop(GRACE);
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
        let asked = Instant::now();
        stop(GRACE);
        assert!(asked.elapsed() < GRACE + Duration::from_secs(1), "stop is prompt");
        assert!(!status().running);
        assert!(Command::new("kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().map(|s| !s.success()).unwrap_or(true));
        let _ = std::fs::remove_dir_all(state);
    }
}
