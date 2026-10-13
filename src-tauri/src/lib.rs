mod press;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
struct LicenseStatus {
    state: &'static str,
}

/// Future editions replace this with a real check. Unchecked does not block.
#[tauri::command]
fn license_check() -> LicenseStatus {
    LicenseStatus { state: "unchecked" }
}

#[tauri::command]
fn engine_detect() -> press::Detect {
    press::detect()
}

#[tauri::command]
async fn engine_install() -> press::Outcome {
    tauri::async_runtime::spawn_blocking(press::install)
        .await
        .unwrap_or_else(|_| press::Outcome::failed(HELPER_STOPPED))
}

/// Attach to a running press, or start Folio's own, and return its url and password.
#[tauri::command]
async fn engine_attach(app: tauri::AppHandle, directory: Option<String>, attach: Option<press::AttachTo>) -> press::Attach {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("app.folio.desktop"));
    tauri::async_runtime::spawn_blocking(move || press::attach(data_dir, directory, attach))
        .await
        .unwrap_or_else(|_| press::Attach::failed(HELPER_STOPPED.into()))
}

#[tauri::command]
fn engine_status() -> press::Status {
    press::status()
}

#[tauri::command]
fn engine_stop() -> press::Outcome {
    press::stop()
}

#[tauri::command]
fn write_file(directory: String, path: String, content: String) -> press::Outcome {
    press::write_file(&directory, &path, &content)
}

#[tauri::command]
fn read_file(directory: String, path: String) -> Result<String, String> {
    press::read_file(&directory, &path)
}

const HELPER_STOPPED: &str = "The press helper stopped unexpectedly.";

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            license_check,
            engine_detect,
            engine_install,
            engine_attach,
            engine_status,
            engine_stop,
            write_file,
            read_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building Folio")
        .run(|_, event| {
            // The press dies with Folio.
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                press::stop();
            }
        });
}
