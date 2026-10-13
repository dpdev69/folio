mod press;

use serde::Serialize;

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
fn engine_install() -> press::Outcome {
    press::install()
}

#[tauri::command]
fn engine_attach(directory: Option<String>, password: Option<String>) -> press::Attach {
    press::attach(directory, password)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            license_check,
            engine_detect,
            engine_install,
            engine_attach
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folio");
}
