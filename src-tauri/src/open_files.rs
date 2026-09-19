use std::path::PathBuf;

use tauri::{Emitter, Manager};

use crate::files::{is_project_path, path_for_frontend, DesktopFileState};

const OPEN_FILES_EVENT: &str = "desktop://open-files";

fn command_line_projects<I>(args: I) -> Vec<PathBuf>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| path.is_file() && is_project_path(path))
        .filter_map(|path| path.canonicalize().ok())
        .collect()
}

pub(crate) fn handle_external_files(app: &tauri::AppHandle, args: Vec<String>) {
    let paths = command_line_projects(args);
    if paths.is_empty() {
        return;
    }

    let state = app.state::<DesktopFileState>();
    let mut ready = Vec::new();
    for path in paths {
        if state.queue_open(path.clone()).is_ok() {
            ready.push(path_for_frontend(&path));
        }
    }

    if !ready.is_empty() {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        let _ = app.emit(OPEN_FILES_EVENT, ready);
    }
}
