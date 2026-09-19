use std::{fs, path::Path};

use crate::files::{
    atomic_write, is_project_path, normalize_path, path_for_frontend, safe_suggested_name,
    validated_export_extension, DesktopFileState,
};

#[tauri::command]
pub(crate) async fn select_project_to_open(
    state: tauri::State<'_, DesktopFileState>,
) -> Result<Option<String>, String> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Open Splinelet project")
        .add_filter("Splinelet project", &["spl"])
        .add_filter("Legacy Splinelet project", &["json"])
        .pick_file()
        .await;

    selected
        .map(|file| {
            if !is_project_path(file.path()) {
                return Err("selected file is not a .spl or .bezier.json project".to_owned());
            }
            state
                .authorize_project(file.path())
                .map(|path| path_for_frontend(&path))
        })
        .transpose()
}

#[tauri::command]
pub(crate) async fn select_project_to_save(
    suggested_name: Option<String>,
    state: tauri::State<'_, DesktopFileState>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Save Splinelet project")
        .add_filter("Splinelet project", &["spl"]);
    if let Some(name) = safe_suggested_name(suggested_name.as_deref(), "Untitled.spl") {
        dialog = dialog.set_file_name(name);
    }

    let selected = dialog.save_file().await;
    selected
        .map(|file| {
            let mut destination = file.path().to_path_buf();
            if destination.extension().and_then(|value| value.to_str()) != Some("spl") {
                destination.set_extension("spl");
            }
            state
                .authorize_save(&destination)
                .map(|path| path_for_frontend(&path))
        })
        .transpose()
}

#[tauri::command]
pub(crate) fn read_project_file(
    path: String,
    state: tauri::State<'_, DesktopFileState>,
) -> Result<Vec<u8>, String> {
    let path = state.can_read(Path::new(&path))?;
    fs::read(&path).map_err(|error| format!("failed to read {}: {error}", path.display()))
}

#[tauri::command]
pub(crate) fn write_project_file_atomic(
    path: String,
    data: Vec<u8>,
    state: tauri::State<'_, DesktopFileState>,
) -> Result<(), String> {
    let path = state.can_write(Path::new(&path))?;
    atomic_write(&path, &data)
        .map_err(|error| format!("failed to save {}: {error}", path.display()))?;
    state.mark_readable(path)
}

#[tauri::command]
pub(crate) async fn export_file(
    suggested_name: Option<String>,
    extension: String,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    let extension = validated_export_extension(&extension)?;
    let fallback = format!("Untitled.{extension}");
    let name = safe_suggested_name(suggested_name.as_deref(), &fallback)
        .unwrap_or_else(|| fallback.clone());
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Export from Splinelet")
        .set_file_name(name)
        .add_filter(format!("{extension} file"), &[extension.as_str()])
        .save_file()
        .await;

    let Some(file) = selected else {
        return Ok(None);
    };
    let path = normalize_path(file.path())?;
    atomic_write(&path, &data)
        .map_err(|error| format!("failed to export {}: {error}", path.display()))?;
    Ok(Some(path_for_frontend(&path)))
}

#[tauri::command]
pub(crate) fn take_pending_open_paths(
    state: tauri::State<'_, DesktopFileState>,
) -> Result<Vec<String>, String> {
    state.take_pending_open_paths()
}
