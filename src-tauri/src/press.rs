use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[derive(Serialize)]
pub struct Detect {
    found: bool,
    path: Option<String>,
}

#[derive(Serialize)]
pub struct Outcome {
    ok: bool,
    error: Option<String>,
}

#[derive(Serialize)]
pub struct Attach {
    ok: bool,
    #[serde(rename = "proxyUrl")]
    proxy_url: Option<String>,
    error: Option<String>,
}

struct Engine {
    proxy: Option<String>,
    /// Kept so the sidecar is not dropped when `attach` returns.
    #[allow(dead_code)]
    child: Option<std::process::Child>,
}

static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);

pub fn detect() -> Detect {
    match find_binary() {
        Some(path) => Detect {
            found: true,
            path: Some(path.display().to_string()),
        },
        None => Detect { found: false, path: None },
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

pub fn attach(directory: Option<String>, password: Option<String>) -> Attach {
    let mut guard = ENGINE.lock().expect("engine lock");
    if let Some(engine) = guard.as_ref() {
        if let Some(url) = &engine.proxy {
            return Attach {
                ok: true,
                proxy_url: Some(url.clone()),
                error: None,
            };
        }
    }

    if !port_open(4096) {
        let Some(binary) = find_binary() else {
            return Attach {
                ok: false,
                proxy_url: None,
                error: Some("opencode is not installed.".into()),
            };
        };
        let mut command = Command::new(binary);
        command
            .args(["serve", "--hostname", "127.0.0.1", "--port", "4096", "--cors", "http://tauri.localhost", "--cors", "tauri://localhost"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Some(dir) = directory.filter(|value| !value.is_empty()) {
            command.current_dir(dir);
        }
        if let Some(password) = password.as_deref().filter(|value| !value.is_empty()) {
            command.env("OPENCODE_SERVER_PASSWORD", password);
            command.env("OPENCODE_SERVER_USERNAME", "opencode");
        }
        match command.spawn() {
            Ok(child) => {
                *guard = Some(Engine {
                    proxy: None,
                    child: Some(child),
                });
            }
            Err(error) => {
                return Attach {
                    ok: false,
                    proxy_url: None,
                    error: Some(error.to_string()),
                };
            }
        }
        drop(guard);
        if !wait_port(4096) {
            return Attach {
                ok: false,
                proxy_url: None,
                error: Some("opencode did not start listening.".into()),
            };
        }
        guard = ENGINE.lock().expect("engine lock");
    }

    let listener = match TcpListener::bind("127.0.0.1:0") {
        Ok(listener) => listener,
        Err(error) => {
            return Attach {
                ok: false,
                proxy_url: None,
                error: Some(error.to_string()),
            };
        }
    };
    let port = listener.local_addr().map(|addr| addr.port()).unwrap_or(0);
    let auth = password
        .filter(|value| !value.is_empty())
        .map(|value| basic("opencode", &value));
    thread::spawn(move || proxy_loop(listener, auth));
    let url = format!("http://127.0.0.1:{port}");
    let engine = guard.get_or_insert(Engine {
        proxy: None,
        child: None,
    });
    engine.proxy = Some(url.clone());
    Attach {
        ok: true,
        proxy_url: Some(url),
        error: None,
    }
}

fn proxy_loop(listener: TcpListener, auth: Option<String>) {
    for incoming in listener.incoming() {
        let Ok(stream) = incoming else { continue };
        let auth = auth.clone();
        thread::spawn(move || {
            let _ = handle_proxy(stream, auth);
        });
    }
}

fn handle_proxy(mut client: TcpStream, auth: Option<String>) -> std::io::Result<()> {
    client.set_read_timeout(Some(Duration::from_secs(30)))?;
    let mut header = Vec::new();
    let mut buf = [0u8; 1024];
    loop {
        let n = client.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        header.extend_from_slice(&buf[..n]);
        if header.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if header.len() > 64 * 1024 {
            return Ok(());
        }
    }
    let split = header.windows(4).position(|w| w == b"\r\n\r\n").unwrap_or(header.len());
    let head = String::from_utf8_lossy(&header[..split]).to_string();
    let mut rest = header[split + 4..].to_vec();
    if head.starts_with("OPTIONS ") {
        let origin = header_value(&head, "origin").unwrap_or("*".into());
        let body = format!(
            "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS\r\nAccess-Control-Max-Age: 600\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        client.write_all(body.as_bytes())?;
        return Ok(());
    }
    let length = header_value(&head, "content-length").and_then(|v| v.parse::<usize>().ok()).unwrap_or(0);
    while rest.len() < length {
        let n = client.read(&mut buf)?;
        if n == 0 {
            break;
        }
        rest.extend_from_slice(&buf[..n]);
    }
    let mut upstream = TcpStream::connect("127.0.0.1:4096")?;
    let rewritten = rewrite_request(&head, auth.as_deref());
    upstream.write_all(rewritten.as_bytes())?;
    upstream.write_all(&rest[..length.min(rest.len())])?;
    let mut response = Vec::new();
    let mut seen = false;
    loop {
        let n = upstream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        response.extend_from_slice(&buf[..n]);
        if !seen {
            if let Some(pos) = response.windows(4).position(|w| w == b"\r\n\r\n") {
                let origin = header_value(&head, "origin").unwrap_or("*".into());
                let prefix = format!(
                    "Access-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Expose-Headers: *\r\n"
                );
                let mut out = response[..pos].to_vec();
                out.extend_from_slice(b"\r\n");
                out.extend_from_slice(prefix.as_bytes());
                out.extend_from_slice(&response[pos + 2..]);
                client.write_all(&out)?;
                seen = true;
                response.clear();
            }
        } else {
            client.write_all(&response)?;
            response.clear();
        }
    }
    if !response.is_empty() {
        client.write_all(&response)?;
    }
    Ok(())
}

fn rewrite_request(head: &str, auth: Option<&str>) -> String {
    let mut lines: Vec<String> = head.split("\r\n").map(|line| line.to_string()).collect();
    if lines.is_empty() {
        return head.to_string();
    }
    lines.retain(|line| {
        let lower = line.to_ascii_lowercase();
        !lower.starts_with("proxy-connection:") && !lower.starts_with("connection:")
    });
    if let Some(auth) = auth {
        if !lines.iter().any(|line| line.to_ascii_lowercase().starts_with("authorization:")) {
            lines.insert(1, format!("Authorization: {auth}"));
        }
    }
    lines.insert(1, "Connection: close".into());
    lines.push(String::new());
    format!("{}\r\n", lines.join("\r\n"))
}

fn header_value(head: &str, name: &str) -> Option<String> {
    let prefix = format!("{name}:");
    head.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.eq_ignore_ascii_case(prefix.trim_end_matches(':')) {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

fn basic(user: &str, password: &str) -> String {
    format!("Basic {}", base64(&format!("{user}:{password}")))
}

fn base64(input: &str) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = input.as_bytes();
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 63) as usize] as char);
        out.push(TABLE[((triple >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((triple >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(triple & 63) as usize] as char } else { '=' });
    }
    out
}

fn find_binary() -> Option<PathBuf> {
    if let Some(env) = std::env::var_os("FOLIO_OPENCODE_BIN") {
        let path = PathBuf::from(env);
        if path.exists() {
            return Some(path);
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let path = PathBuf::from(home).join(".opencode/bin/opencode");
        if path.exists() {
            return Some(path);
        }
    }
    if let Ok(output) = Command::new("which").arg("opencode").output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !text.is_empty() {
                return Some(PathBuf::from(text));
            }
        }
    }
    None
}

fn port_open(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn wait_port(port: u16) -> bool {
    for _ in 0..40 {
        if port_open(port) {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}
