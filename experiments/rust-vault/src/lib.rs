use ignore::gitignore::{Gitignore, GitignoreBuilder};
use napi_derive::napi;
use std::{ffi::OsStr, fs, path::Path};

fn ignored(matcher: &Gitignore, relative: &str) -> bool {
    let path = Path::new(relative);
    let mut parents: Vec<_> = path
        .ancestors()
        .skip(1)
        .filter(|p| !p.as_os_str().is_empty())
        .collect();
    parents.reverse();
    parents
        .into_iter()
        .any(|parent| matcher.matched(parent, true).is_ignore())
        || matcher.matched(path, false).is_ignore()
}

fn collect(
    directory: &Path,
    root: &Path,
    matcher: Option<&Gitignore>,
    paths: &mut Vec<String>,
) -> napi::Result<()> {
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
        let relative = path
            .strip_prefix(root)
            .map_err(|error| napi::Error::from_reason(error.to_string()))?;
        let value = relative.to_string_lossy();
        let value = if cfg!(windows) {
            value.replace('\\', "/")
        } else {
            value.into_owned()
        };
        if matcher.is_some_and(|matcher| ignored(matcher, &value)) {
            continue;
        }
        if file_type.is_dir() {
            collect(&path, root, matcher, paths)?;
        } else if path.extension().and_then(OsStr::to_str).is_some_and(|ext| {
            matches!(
                ext.to_lowercase().as_str(),
                "md" | "flow" | "canvas" | "json"
            )
        }) {
            paths.push(value);
        }
    }
    Ok(())
}

#[napi]
pub fn list_note_paths(root: String) -> napi::Result<Vec<String>> {
    let root =
        fs::canonicalize(root).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let matcher = fs::read(root.join(".taglineignore"))
        .ok()
        .and_then(|contents| {
            let contents = String::from_utf8_lossy(&contents);
            let mut builder = GitignoreBuilder::new("");
            builder.case_insensitive(true).ok()?;
            for line in contents.split('\n') {
                let _ = builder.add_line(None, line.trim_end_matches('\r'));
            }
            builder.build().ok()
        });
    let mut paths = Vec::new();
    collect(&root, &root, matcher.as_ref(), &mut paths)?;
    paths.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    Ok(paths)
}
