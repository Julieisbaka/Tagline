use napi_derive::napi;
use std::{ffi::OsStr, fs, path::Path};

fn collect(directory: &Path, root: &Path, paths: &mut Vec<String>) -> napi::Result<()> {
    let entries =
        fs::read_dir(directory).map_err(|error| napi::Error::from_reason(error.to_string()))?;

    for entry in entries {
        let entry = entry.map_err(|error| napi::Error::from_reason(error.to_string()))?;
        let file_type = entry
            .file_type()
            .map_err(|error| napi::Error::from_reason(error.to_string()))?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }

        let path = entry.path();
        if file_type.is_dir() {
            collect(&path, root, paths)?;
        } else if path.extension().and_then(OsStr::to_str).is_some_and(|ext| {
            matches!(
                ext.to_lowercase().as_str(),
                "md" | "flow" | "canvas" | "json"
            )
        }) {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| napi::Error::from_reason(error.to_string()))?;
            let value = relative.to_string_lossy();
            paths.push(if cfg!(windows) {
                value.replace('\\', "/")
            } else {
                value.into_owned()
            });
        }
    }
    Ok(())
}

#[napi]
pub fn list_note_paths(root: String) -> napi::Result<Vec<String>> {
    let root =
        fs::canonicalize(root).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let mut paths = Vec::new();
    collect(&root, &root, &mut paths)?;
    paths.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    Ok(paths)
}
