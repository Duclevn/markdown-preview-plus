use std::ffi::OsStr;
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, Runtime, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

const MAX_DOCUMENT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Default)]
struct PendingOpenPaths {
    frontend_ready: bool,
    paths: Vec<PathBuf>,
}

#[derive(Default)]
struct NativeState {
    authorized_document: Mutex<Option<AuthorizedDocument>>,
    pending_open_paths: Mutex<PendingOpenPaths>,
    next_document_grant_id: AtomicU64,
}

struct AuthorizedDocument {
    path: PathBuf,
    grant_id: String,
}

#[derive(Serialize)]
struct Document {
    name: String,
    content: String,
    #[serde(rename = "documentGrantId")]
    document_grant_id: String,
}

#[tauri::command]
fn read_document(state: State<'_, NativeState>) -> Result<Option<Document>, String> {
    let path = {
        let mut pending = state
            .pending_open_paths
            .lock()
            .map_err(|_| "The document reader is unavailable.".to_owned())?;
        pending.frontend_ready = true;
        match pending.paths.len() {
            0 => None,
            1 => pending.paths.pop(),
            _ => {
                pending.paths.clear();
                return Err("Open one Markdown file at a time.".into());
            }
        }
    };

    path.map(|path| read_document_path(&path, state.inner()))
        .transpose()
}

#[tauri::command]
async fn open_document(
    app: AppHandle,
    state: State<'_, NativeState>,
) -> Result<Option<Document>, String> {
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_title("Open a Markdown file")
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file(move |selected| {
            let _ = sender.try_send(selected);
        });

    let Some(Some(selected)) = receiver.recv().await else {
        return Ok(None);
    };

    let path = selected
        .into_path()
        .map_err(|error| format!("The selected path is unavailable: {error}"))?;
    read_document_path(&path, state.inner()).map(Some)
}

fn read_document_path(path: &Path, state: &NativeState) -> Result<Document, String> {
    let canonical_path = fs_canonicalize(path)?;
    if !is_markdown_path(&canonical_path) {
        return Err("Choose a .md or .markdown file.".into());
    }

    let file_name = canonical_path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "This file name cannot be represented by the reader.".to_owned())?
        .to_owned();

    let file = File::open(&canonical_path).map_err(|error| error.to_string())?;
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

    let document_grant_id = authorize_document(state, canonical_path)?;

    Ok(Document {
        name: file_name,
        content,
        document_grant_id,
    })
}

#[tauri::command]
fn read_local_image(
    document_grant_id: String,
    relative_path: String,
    state: State<'_, NativeState>,
) -> Result<String, String> {
    read_local_image_path(&document_grant_id, &relative_path, state.inner())
}

fn authorize_document(state: &NativeState, canonical_path: PathBuf) -> Result<String, String> {
    let sequence = state.next_document_grant_id.fetch_add(1, Ordering::Relaxed);
    let grant_id = format!("mpp-{sequence:016x}");
    *state
        .authorized_document
        .lock()
        .map_err(|_| "The document reader is unavailable.".to_owned())? =
        Some(AuthorizedDocument {
            path: canonical_path,
            grant_id: grant_id.clone(),
        });
    Ok(grant_id)
}

fn read_local_image_path(
    document_grant_id: &str,
    relative_path: &str,
    state: &NativeState,
) -> Result<String, String> {
    let authorized_document = state
        .authorized_document
        .lock()
        .map_err(|_| "The document reader is unavailable.".to_owned())?;
    let authorized_document = authorized_document
        .as_ref()
        .ok_or_else(|| "Open a Markdown file before loading its images.".to_owned())?;
    if authorized_document.grant_id != document_grant_id {
        return Err("The document grant is stale or invalid.".into());
    }

    let relative = Path::new(relative_path);
    if !is_safe_relative_image_path(relative_path) {
        return Err("Only relative local image paths are allowed.".into());
    }

    let document_directory = authorized_document
        .path
        .parent()
        .ok_or_else(|| "The document has no parent directory.".to_owned())?;
    let candidate = document_directory.join(relative);
    let canonical_image = fs_canonicalize(&candidate)?;
    if !canonical_image.starts_with(document_directory) {
        return Err("The image must be inside the document's directory.".into());
    }

    let mime_type = raster_image_mime(&canonical_image)
        .ok_or_else(|| "Only PNG, JPEG, GIF, WebP, and BMP images are supported.".to_owned())?;
    let file = File::open(&canonical_image).map_err(|error| error.to_string())?;
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

    Ok(format!(
        "data:{mime_type};base64,{}",
        STANDARD.encode(bytes)
    ))
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

fn markdown_arguments<I, S>(arguments: I, working_directory: &Path) -> Vec<PathBuf>
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
            Some(absolute_path)
        })
        .collect()
}

fn deliver_open_paths<R: Runtime>(app: &AppHandle<R>, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }

    let Some(state) = app.try_state::<NativeState>() else {
        return;
    };
    let pending_count = match state.pending_open_paths.lock() {
        Ok(mut pending) => {
            for path in paths {
                if !pending.paths.contains(&path) {
                    pending.paths.push(path);
                }
            }
            if !pending.frontend_ready {
                return;
            }
            let count = pending.paths.len();
            if count != 1 {
                pending.paths.clear();
            }
            count
        }
        Err(_) => return,
    };

    let _ = app.emit("open-files", pending_count);
}

fn emit_drag_state<R: Runtime>(app: &AppHandle<R>, state: &'static str) {
    let _ = app.emit("drag-state", state);
}

fn handle_drag_drop<R: Runtime>(app: &AppHandle<R>, event: &DragDropEvent) {
    match event {
        DragDropEvent::Enter { .. } | DragDropEvent::Over { .. } => emit_drag_state(app, "enter"),
        DragDropEvent::Leave => emit_drag_state(app, "leave"),
        DragDropEvent::Drop { paths, .. } => {
            emit_drag_state(app, "leave");
            deliver_open_paths(app, paths.clone());
        }
        _ => {}
    }
}

fn is_safe_relative_image_path(path: &str) -> bool {
    let relative = Path::new(path);
    !path.is_empty()
        && !path
            .chars()
            .any(|character| matches!(character, '\\' | '?' | '#' | ':'))
        && !relative.is_absolute()
        && relative
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
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
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        "image/bmp" => bytes.starts_with(b"BM"),
        _ => false,
    }
}

pub fn run() {
    let working_directory = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let startup_paths = markdown_arguments(std::env::args_os().skip(1), &working_directory);
    let state = NativeState {
        pending_open_paths: Mutex::new(PendingOpenPaths {
            frontend_ready: false,
            paths: startup_paths,
        }),
        ..Default::default()
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
            open_document,
            read_document,
            read_local_image
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Markdown Preview Plus");

    app.run(|app, event| match event {
        tauri::RunEvent::WindowEvent { label, event, .. } if label == "main" => {
            if let WindowEvent::DragDrop(event) = event {
                handle_drag_drop(app, &event);
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Opened { urls } => {
            let paths = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| is_markdown_path(path))
                .collect();
            deliver_open_paths(app, paths);
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "markdown-preview-plus-{label}-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).expect("create test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn authorized_state(document: &Path) -> (NativeState, String) {
        let state = NativeState::default();
        let grant_id = authorize_document(
            &state,
            fs_canonicalize(document).expect("canonical document"),
        )
        .expect("issue document grant");
        (state, grant_id)
    }

    #[test]
    fn accepts_markdown_extensions_and_filters_startup_arguments() {
        assert!(is_markdown_path(Path::new("notes.MARKDOWN")));
        assert!(!is_markdown_path(Path::new("notes.txt")));

        let working_directory = Path::new("C:\\workspace");
        let arguments = markdown_arguments(
            ["--debug", "notes.md", "image.png", "nested/guide.MD"],
            working_directory,
        );
        assert_eq!(
            arguments,
            vec![
                working_directory.join("notes.md"),
                working_directory.join("nested/guide.MD"),
            ]
        );
    }

    #[test]
    fn rejects_unsafe_relative_image_paths() {
        assert!(is_safe_relative_image_path("images/diagram.png"));
        assert!(is_safe_relative_image_path("./diagram.png"));
        assert!(!is_safe_relative_image_path("../diagram.png"));
        assert!(!is_safe_relative_image_path("C:/secret.png"));
        assert!(!is_safe_relative_image_path("images\\diagram.png"));
        assert!(!is_safe_relative_image_path("diagram.png?raw=1"));
    }

    #[test]
    fn image_reads_require_an_authorized_document_and_matching_signature() {
        let directory = TestDirectory::new("image-policy");
        let document = directory.path().join("notes.md");
        let image = directory.path().join("diagram.png");
        fs::write(&document, b"# Notes").expect("write document");
        fs::write(&image, b"not a png").expect("write image");

        let state = NativeState::default();
        let error = read_local_image_path("missing-grant", "diagram.png", &state)
            .expect_err("unauthorized image read");
        assert!(error.contains("Open a Markdown file"));

        let (state, grant_id) = authorized_state(&document);
        let error =
            read_local_image_path(&grant_id, "diagram.png", &state).expect_err("wrong signature");
        assert!(error.contains("does not match"));
        let error =
            read_local_image_path(&grant_id, "../diagram.png", &state).expect_err("traversal");
        assert!(error.contains("relative local image paths"));
    }

    #[test]
    fn image_reads_reject_oversized_files_before_encoding() {
        let directory = TestDirectory::new("image-size");
        let document = directory.path().join("notes.md");
        let image = directory.path().join("diagram.png");
        fs::write(&document, b"# Notes").expect("write document");
        fs::write(&image, b"\x89PNG\r\n\x1a\n").expect("write image header");
        fs::OpenOptions::new()
            .write(true)
            .open(&image)
            .expect("open image")
            .set_len(MAX_IMAGE_BYTES + 1)
            .expect("extend image");

        let (state, grant_id) = authorized_state(&document);
        let error =
            read_local_image_path(&grant_id, "diagram.png", &state).expect_err("oversized image");
        assert!(error.contains("5 MiB or smaller"));
    }

    #[test]
    fn document_reads_reject_oversized_files() {
        let directory = TestDirectory::new("document-size");
        let document = directory.path().join("notes.md");
        fs::write(&document, b"# Notes").expect("write document");
        fs::OpenOptions::new()
            .write(true)
            .open(&document)
            .expect("open document")
            .set_len(MAX_DOCUMENT_BYTES + 1)
            .expect("extend document");

        let state = NativeState::default();
        let error = match read_document_path(&document, &state) {
            Ok(_) => panic!("oversized document was accepted"),
            Err(error) => error,
        };
        assert!(error.contains("20 MiB or smaller"));
    }

    #[test]
    fn image_signature_checks_cover_supported_rasters() {
        assert!(matches_image_signature("image/png", b"\x89PNG\r\n\x1a\n"));
        assert!(matches_image_signature("image/jpeg", b"\xff\xd8\xff"));
        assert!(matches_image_signature("image/gif", b"GIF89a"));
        assert!(matches_image_signature("image/webp", b"RIFF1234WEBP"));
        assert!(matches_image_signature("image/bmp", b"BM"));
        assert!(!matches_image_signature("image/png", b"GIF89a"));
        assert!(!matches_image_signature("image/svg+xml", b"<svg>"));
    }

    #[test]
    fn queued_image_request_from_a_cannot_read_b_after_replacement() {
        let directory_a = TestDirectory::new("image-grant-a");
        let directory_b = TestDirectory::new("image-grant-b");
        let document_a = directory_a.path().join("notes.md");
        let document_b = directory_b.path().join("notes.md");
        let image_a = directory_a.path().join("image.png");
        let image_b = directory_b.path().join("image.png");
        fs::write(&document_a, b"# A").expect("write document A");
        fs::write(&document_b, b"# B").expect("write document B");
        fs::write(&image_a, b"\x89PNG\r\n\x1a\nA").expect("write image A");
        fs::write(&image_b, b"\x89PNG\r\n\x1a\nB").expect("write image B");

        let state = NativeState::default();
        let grant_a = read_document_path(&document_a, &state)
            .expect("read document A")
            .document_grant_id;
        let grant_b = read_document_path(&document_b, &state)
            .expect("read document B")
            .document_grant_id;
        assert_ne!(grant_a, grant_b);

        let error = read_local_image_path(&grant_a, "image.png", &state)
            .expect_err("stale A grant must not read B's image");
        assert!(error.contains("stale or invalid"));

        let image = read_local_image_path(&grant_b, "image.png", &state)
            .expect("current B grant should read B's image");
        assert!(image.starts_with("data:image/png;base64,"));
    }

    #[cfg(unix)]
    #[test]
    fn image_reads_reject_symlink_escape() {
        let directory = TestDirectory::new("image-symlink");
        let outside = TestDirectory::new("image-symlink-outside");
        let document = directory.path().join("notes.md");
        let outside_image = outside.path().join("outside.png");
        let link = directory.path().join("linked.png");
        fs::write(&document, b"# Notes").expect("write document");
        fs::write(&outside_image, b"\x89PNG\r\n\x1a\n").expect("write image");
        std::os::unix::fs::symlink(&outside_image, &link).expect("create symlink");

        let (state, grant_id) = authorized_state(&document);
        let error =
            read_local_image_path(&grant_id, "linked.png", &state).expect_err("symlink escape");
        assert!(error.contains("inside the document's directory"));
    }
}
