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

/// Run blocking press work off the main thread; if the helper thread dies, answer with `fallback`.
async fn off_main<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static, fallback: impl FnOnce() -> T) -> T {
    tauri::async_runtime::spawn_blocking(work).await.unwrap_or_else(|_| fallback())
}

#[tauri::command]
async fn engine_detect() -> press::Detect {
    off_main(press::detect, press::Detect::missing).await
}

#[tauri::command]
async fn engine_install() -> press::Outcome {
    off_main(press::install, || press::Outcome::failed(HELPER_STOPPED)).await
}

/// Attach to a running press, or start Folio's own, and return its url and password.
#[tauri::command]
async fn engine_attach(app: tauri::AppHandle, directory: Option<String>, attach: Option<press::AttachTo>) -> press::Attach {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("app.folio.desktop"));
    off_main(move || press::attach(data_dir, directory, attach), || press::Attach::failed(HELPER_STOPPED.into())).await
}

#[tauri::command]
async fn engine_status() -> press::Status {
    off_main(press::status, press::Status::unknown).await
}

#[tauri::command]
async fn engine_stop() -> press::Outcome {
    off_main(|| press::stop(press::GRACE), || press::Outcome::failed(HELPER_STOPPED)).await
}

#[tauri::command]
async fn write_file(directory: String, path: String, content: String) -> press::Outcome {
    off_main(move || press::write_file(&directory, &path, &content), || press::Outcome::failed(HELPER_STOPPED)).await
}

#[tauri::command]
async fn remove_file(directory: String, path: String) -> press::Outcome {
    off_main(move || press::remove_file(&directory, &path), || press::Outcome::failed(HELPER_STOPPED)).await
}

#[tauri::command]
async fn read_file(directory: String, path: String) -> Result<String, String> {
    off_main(move || press::read_file(&directory, &path), || Err(HELPER_STOPPED.into())).await
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
            remove_file,
            read_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building Folio")
        .run(|_, event| {
            // The press dies with Folio: its stdin closes, it gets a short grace, then it is killed.
            // The first of these events takes the press; the second finds nothing to stop.
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                press::stop(press::GRACE);
            }
        });
}
