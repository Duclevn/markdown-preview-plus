use std::ffi::OsStr;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

const MAX_DOCUMENT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Default)]
struct PendingOpenPaths {
    frontend_ready: bool,
    paths: Vec<String>,
}

#[derive(Default)]
struct NativeState {
    authorized_document: Mutex<Option<PathBuf>>,
    pending_open_paths: Mutex<PendingOpenPaths>,
}

#[derive(Serialize)]
struct Document {
    path: String,
    name: String,
    content: String,
}

#[tauri::command]
fn read_document(path: String, state: State<'_, NativeState>) -> Result<Document, String> {
    let canonical_path = fs_canonicalize(Path::new(&path))?;
    if !is_markdown_path(&canonical_path) {
        return Err("Choose a .md or .markdown file.".into());
    }

    let canonical_path_string = canonical_path
        .to_str()
        .ok_or_else(|| "This file path cannot be represented by the reader.".to_owned())?
        .to_owned();
    let file_name = canonical_path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "This file name cannot be represented by the reader.".to_owned())?
        .to_owned();

    let mut file = File::open(&canonical_path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("The selected path is not a regular file.".into());
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err("Markdown files must be 20 MiB or smaller.".into());
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("Markdown files must be 20 MiB or smaller.".into());
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| "The selected file is not valid UTF-8 text.".to_owned())?;

    *state
        .authorized_document
        .lock()
        .map_err(|_| "The document reader is unavailable.".to_owned())? = Some(canonical_path);

    Ok(Document {
        path: canonical_path_string,
        name: file_name,
        content,
    })
}

#[tauri::command]
fn read_local_image(
    document_path: String,
    relative_path: String,
    state: State<'_, NativeState>,
) -> Result<String, String> {
    let authorized_document = state
        .authorized_document
        .lock()
        .map_err(|_| "The document reader is unavailable.".to_owned())?;
    let authorized_path = authorized_document
        .as_ref()
        .ok_or_else(|| "Open a Markdown file before loading its images.".to_owned())?;

    let requested_document = fs_canonicalize(Path::new(&document_path))?;
    if requested_document.as_path() != authorized_path.as_path() {
        return Err("Images can only be loaded for the currently open document.".into());
    }

    let relative = Path::new(&relative_path);
    if relative_path.is_empty()
        || relative_path
            .chars()
            .any(|character| matches!(character, '\\' | '?' | '#' | ':'))
        || relative.is_absolute()
        || relative.components().any(|component| {
            !matches!(component, Component::Normal(_) | Component::CurDir)
        })
    {
        return Err("Only relative local image paths are allowed.".into());
    }

    let document_directory = authorized_path
        .parent()
        .ok_or_else(|| "The document has no parent directory.".to_owned())?;
    let candidate = document_directory.join(relative);
    let canonical_image = fs_canonicalize(&candidate)?;
    if !canonical_image.starts_with(document_directory) {
        return Err("The image must be inside the document's directory.".into());
    }

    let mime_type = raster_image_mime(&canonical_image)
        .ok_or_else(|| "Only PNG, JPEG, GIF, WebP, and BMP images are supported.".to_owned())?;
    let mut file = File::open(&canonical_image).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("The selected image path is not a regular file.".into());
    }
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("Local images must be 5 MiB or smaller.".into());
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("Local images must be 5 MiB or smaller.".into());
    }
    if !matches_image_signature(mime_type, &bytes) {
        return Err("The local image content does not match its file type.".into());
    }

    Ok(format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)))
}

#[tauri::command]
fn take_pending_paths(state: State<'_, NativeState>) -> Result<Vec<String>, String> {
    let mut pending = state
        .pending_open_paths
        .lock()
        .map_err(|_| "The document reader is unavailable.".to_owned())?;
    pending.frontend_ready = true;
    Ok(std::mem::take(&mut pending.paths))
}

fn fs_canonicalize(path: &Path) -> Result<PathBuf, String> {
    std::fs::canonicalize(path).map_err(|error| error.to_string())
}

fn is_markdown_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(OsStr::to_str)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown")
    )
}

fn markdown_arguments<I, S>(arguments: I, working_directory: &Path) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    arguments
        .into_iter()
        .filter_map(|argument| {
            let argument = argument.as_ref().to_str()?;
            if argument.is_empty() || argument.starts_with('-') {
                return None;
            }

            let path = Path::new(argument);
            if !is_markdown_path(path) {
                return None;
            }

            let absolute_path = if path.is_absolute() {
                path.to_path_buf()
            } else {
                working_directory.join(path)
            };
            absolute_path.to_str().map(str::to_owned)
        })
        .collect()
}

fn deliver_open_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    let Some(state) = app.try_state::<NativeState>() else {
        return;
    };
    let emit_now = match state.pending_open_paths.lock() {
        Ok(mut pending) if pending.frontend_ready => true,
        Ok(mut pending) => {
            pending.paths.extend(paths.iter().cloned());
            false
        }
        Err(_) => return,
    };

    if emit_now {
        let _ = app.emit("open-files", paths);
    }
}

fn raster_image_mime(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("bmp") => Some("image/bmp"),
        _ => None,
    }
}

fn matches_image_signature(mime_type: &str, bytes: &[u8]) -> bool {
    match mime_type {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(b"\xff\xd8\xff"),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => {
            bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP"
        }
        "image/bmp" => bytes.starts_with(b"BM"),
        _ => false,
    }
}

pub fn run() {
    let working_directory = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let startup_paths = markdown_arguments(std::env::args_os().skip(1), &working_directory);
    let state = NativeState {
        authorized_document: Mutex::new(None),
        pending_open_paths: Mutex::new(PendingOpenPaths {
            frontend_ready: false,
            paths: startup_paths,
        }),
    };

    let app = tauri::Builder::default()
        .manage(state)
        // Keep this plugin first so a second launch reaches the existing WebView.
        .plugin(tauri_plugin_single_instance::init(|app, arguments, cwd| {
            let paths = markdown_arguments(arguments.into_iter().skip(1), Path::new(&cwd));
            deliver_open_paths(app, paths);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            read_local_image,
            take_pending_paths
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Markdown Preview Plus");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| is_markdown_path(path))
                .filter_map(|path| path.to_str().map(str::to_owned))
                .collect();
            deliver_open_paths(app, paths);
        }

        #[cfg(not(target_os = "macos"))]
        let _ = (app, event);
    });
}
