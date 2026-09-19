use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Default)]
pub(crate) struct DesktopFileState {
    readable: Mutex<HashSet<PathBuf>>,
    writable: Mutex<HashSet<PathBuf>>,
    pending_open: Mutex<Vec<PathBuf>>,
}

impl DesktopFileState {
    pub(crate) fn authorize_project(&self, path: &Path) -> Result<PathBuf, String> {
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

    pub(crate) fn authorize_save(&self, path: &Path) -> Result<PathBuf, String> {
        let normalized = normalize_path(path)?;
        self.writable
            .lock()
            .map_err(|_| "write permission state is unavailable".to_owned())?
            .insert(normalized.clone());
        Ok(normalized)
    }

    pub(crate) fn can_read(&self, path: &Path) -> Result<PathBuf, String> {
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

    pub(crate) fn can_write(&self, path: &Path) -> Result<PathBuf, String> {
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

    pub(crate) fn mark_readable(&self, path: PathBuf) -> Result<(), String> {
        self.readable
            .lock()
            .map_err(|_| "read permission state is unavailable".to_owned())?
            .insert(path);
        Ok(())
    }

    pub(crate) fn queue_open(&self, path: PathBuf) -> Result<(), String> {
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

    pub(crate) fn take_pending_open_paths(&self) -> Result<Vec<String>, String> {
        let mut pending = self
            .pending_open
            .lock()
            .map_err(|_| "pending file state is unavailable".to_owned())?;
        Ok(pending
            .drain(..)
            .map(|path| path_for_frontend(&path))
            .collect())
    }
}

pub(crate) fn path_for_frontend(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub(crate) fn normalize_path(path: &Path) -> Result<PathBuf, String> {
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

pub(crate) fn is_project_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    name.ends_with(".spl") || name.ends_with(".bezier.json")
}

pub(crate) fn safe_suggested_name(name: Option<&str>, fallback: &str) -> Option<String> {
    let name = name.unwrap_or(fallback).trim();
    let file_name = Path::new(name).file_name()?.to_string_lossy();
    (!file_name.is_empty()).then(|| file_name.into_owned())
}

pub(crate) fn validated_export_extension(extension: &str) -> Result<String, String> {
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

pub(crate) fn atomic_write(path: &Path, data: &[u8]) -> io::Result<()> {
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
