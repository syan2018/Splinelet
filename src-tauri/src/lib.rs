use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{Emitter, Manager};

const OPEN_FILES_EVENT: &str = "desktop://open-files";

#[derive(Default)]
struct DesktopFileState {
    readable: Mutex<HashSet<PathBuf>>,
    writable: Mutex<HashSet<PathBuf>>,
    pending_open: Mutex<Vec<PathBuf>>,
}

impl DesktopFileState {
    fn authorize_project(&self, path: &Path) -> Result<PathBuf, String> {
        let normalized = normalize_path(path)?;
        self.readable
            .lock()
            .map_err(|_| "read permission state is unavailable".to_owned())?
            .insert(normalized.clone());
        self.writable
            .lock()
            .map_err(|_| "write permission state is unavailable".to_owned())?
            .insert(normalized.clone());
        Ok(normalized)
    }

    fn authorize_save(&self, path: &Path) -> Result<PathBuf, String> {
        let normalized = normalize_path(path)?;
        self.writable
            .lock()
            .map_err(|_| "write permission state is unavailable".to_owned())?
            .insert(normalized.clone());
        Ok(normalized)
    }

    fn can_read(&self, path: &Path) -> Result<PathBuf, String> {
        let normalized = normalize_path(path)?;
        let allowed = self
            .readable
            .lock()
            .map_err(|_| "read permission state is unavailable".to_owned())?
            .contains(&normalized);
        allowed
            .then_some(normalized)
            .ok_or_else(|| "the file was not selected by the user".to_owned())
    }

    fn can_write(&self, path: &Path) -> Result<PathBuf, String> {
        let normalized = normalize_path(path)?;
        let allowed = self
            .writable
            .lock()
            .map_err(|_| "write permission state is unavailable".to_owned())?
            .contains(&normalized);
        allowed
            .then_some(normalized)
            .ok_or_else(|| "the destination was not selected by the user".to_owned())
    }

    fn queue_open(&self, path: PathBuf) -> Result<(), String> {
        let path = self.authorize_project(&path)?;
        let mut pending = self
            .pending_open
            .lock()
            .map_err(|_| "pending file state is unavailable".to_owned())?;
        if !pending.contains(&path) {
            pending.push(path);
        }
        Ok(())
    }
}

fn path_for_frontend(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn normalize_path(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() {
        return Err("file path is empty".to_owned());
    }

    if path.exists() {
        return path
            .canonicalize()
            .map_err(|error| format!("failed to resolve file path: {error}"));
    }

    let file_name = path
        .file_name()
        .ok_or_else(|| "file path has no file name".to_owned())?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("failed to resolve destination directory: {error}"))?;
    Ok(parent.join(file_name))
}

fn is_project_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    name.ends_with(".spl") || name.ends_with(".bezier.json")
}

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

#[tauri::command]
async fn select_project_to_open(
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
async fn select_project_to_save(
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
fn read_project_file(
    path: String,
    state: tauri::State<'_, DesktopFileState>,
) -> Result<Vec<u8>, String> {
    let path = state.can_read(Path::new(&path))?;
    fs::read(&path).map_err(|error| format!("failed to read {}: {error}", path.display()))
}

#[tauri::command]
fn write_project_file_atomic(
    path: String,
    data: Vec<u8>,
    state: tauri::State<'_, DesktopFileState>,
) -> Result<(), String> {
    let path = state.can_write(Path::new(&path))?;
    atomic_write(&path, &data)
        .map_err(|error| format!("failed to save {}: {error}", path.display()))?;
    state
        .readable
        .lock()
        .map_err(|_| "read permission state is unavailable".to_owned())?
        .insert(path);
    Ok(())
}

#[tauri::command]
async fn export_file(
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
fn take_pending_open_paths(
    state: tauri::State<'_, DesktopFileState>,
) -> Result<Vec<String>, String> {
    let mut pending = state
        .pending_open
        .lock()
        .map_err(|_| "pending file state is unavailable".to_owned())?;
    Ok(pending
        .drain(..)
        .map(|path| path_for_frontend(&path))
        .collect())
}

fn safe_suggested_name(name: Option<&str>, fallback: &str) -> Option<String> {
    let name = name.unwrap_or(fallback).trim();
    let file_name = Path::new(name).file_name()?.to_string_lossy();
    (!file_name.is_empty()).then(|| file_name.into_owned())
}

fn validated_export_extension(extension: &str) -> Result<String, String> {
    let extension = extension
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    const ALLOWED: &[&str] = &["3mf", "stl", "svg", "py", "json"];
    ALLOWED
        .contains(&extension.as_str())
        .then_some(extension)
        .ok_or_else(|| "unsupported export file extension".to_owned())
}

fn atomic_write(path: &Path, data: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "destination has no file name")
    })?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let mut temporary = None;
    for attempt in 0..16_u8 {
        let candidate = parent.join(format!(
            ".{}.{}.{}.tmp",
            file_name.to_string_lossy(),
            std::process::id(),
            nonce + u128::from(attempt)
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                temporary = Some((candidate, file));
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    let (temporary_path, mut temporary_file) = temporary.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not create a temporary file",
        )
    })?;
    let write_result = (|| {
        temporary_file.write_all(data)?;
        temporary_file.sync_all()?;
        drop(temporary_file);
        replace_file(&temporary_path, path)?;
        sync_parent_directory(parent)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    write_result
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> io::Result<()> {
    fs::File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> io::Result<()> {
    Ok(())
}

fn handle_external_files(app: &tauri::AppHandle, args: Vec<String>) {
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
