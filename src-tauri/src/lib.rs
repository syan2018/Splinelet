mod commands;
mod files;
mod open_files;

use commands::{
    export_file, read_project_file, select_project_to_open, select_project_to_save,
    take_pending_open_paths, write_project_file_atomic,
};
use files::DesktopFileState;
use open_files::handle_external_files;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopFileState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            handle_external_files(app, args);
        }))
        .setup(|app| {
            let args = std::env::args().collect();
            handle_external_files(app.handle(), args);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_project_to_open,
            select_project_to_save,
            read_project_file,
            write_project_file_atomic,
            export_file,
            take_pending_open_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running Splinelet");
}
