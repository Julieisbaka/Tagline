use ignore::gitignore::{Gitignore, GitignoreBuilder};
use napi_derive::napi;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    ffi::OsStr,
    fs, io,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::UNIX_EPOCH,
};

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

fn load_ignore_rules(root: &Path) -> Option<Gitignore> {
    fs::read(root.join(".taglineignore"))
        .ok()
        .and_then(|contents| {
            let contents = String::from_utf8_lossy(&contents);
            let mut builder = GitignoreBuilder::new("");
            builder.case_insensitive(true).ok()?;
            for line in contents.split('\n') {
                builder.add_line(None, line.trim_end_matches('\r')).ok()?;
            }
            builder.build().ok()
        })
}

#[napi]
pub fn list_note_paths(root: String) -> napi::Result<Vec<String>> {
    let root =
        fs::canonicalize(root).map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let matcher = load_ignore_rules(&root);
    let mut paths = Vec::new();
    collect(&root, &root, matcher.as_ref(), &mut paths)?;
    paths.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    Ok(paths)
}

#[napi(object)]
pub struct VaultEntry {
    pub parent: i32,
    pub name: String,
    pub path: String,
    pub is_folder: bool,
    pub mtime: Option<f64>,
    pub text: Option<String>,
}

struct CachedText {
    mtime: f64,
    size: u64,
    text: String,
}

static CONTENTS: OnceLock<Mutex<HashMap<String, HashMap<String, CachedText>>>> = OnceLock::new();

fn fs_error(error: io::Error) -> napi::Error {
    let code = match error.kind() {
        io::ErrorKind::NotFound => "ENOENT",
        io::ErrorKind::PermissionDenied => "EACCES",
        io::ErrorKind::NotADirectory => "ENOTDIR",
        io::ErrorKind::IsADirectory => "EISDIR",
        _ => "UNKNOWN",
    };
    napi::Error::from_reason(format!(
        "TAGLINE_VAULT_ERROR:{code}:{}: {error}",
        error.raw_os_error().unwrap_or(0)
    ))
}

fn mtime_ms(time: std::time::SystemTime) -> f64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs() as f64 * 1000.0 + duration.subsec_nanos() as f64 / 1e6,
        Err(error) => {
            let duration = error.duration();
            -(duration.as_secs() as f64 * 1000.0 + duration.subsec_nanos() as f64 / 1e6)
        }
    }
}

#[napi]
pub fn load_vault(
    root: String,
    base: String,
    include_contents: bool,
) -> napi::Result<Vec<VaultEntry>> {
    let root_path = Path::new(&root);
    let matcher = load_ignore_rules(root_path);
    let mut entries: Vec<VaultEntry> = Vec::new();
    let mut directories = VecDeque::from([(root_path.to_path_buf(), base, -1)]);
    let mut files: Vec<(PathBuf, usize)> = Vec::new();
    while let Some((directory, prefix, parent)) = directories.pop_front() {
        for entry in fs::read_dir(&directory).map_err(fs_error)? {
            let entry = entry.map_err(fs_error)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if matcher
                .as_ref()
                .is_some_and(|matcher| ignored(matcher, &relative))
            {
                continue;
            }
            let folder = entry.file_type().map_err(fs_error)?.is_dir();
            if !folder
                && !Path::new(&name)
                    .extension()
                    .and_then(OsStr::to_str)
                    .is_some_and(|ext| {
                        matches!(
                            ext.to_lowercase().as_str(),
                            "md" | "flow" | "canvas" | "json"
                        )
                    })
            {
                continue;
            }
            // Node reconstructs paths from decoded directory entry names.
            let full = directory.join(&name);
            let index = entries.len();
            entries.push(VaultEntry {
                parent,
                name,
                path: relative.clone(),
                is_folder: folder,
                mtime: None,
                text: None,
            });
            if folder {
                directories.push_back((full, relative, index as i32));
            } else {
                files.push((full, index));
            }
        }
    }
    let mut cache = CONTENTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let mut unused_cache = HashMap::new();
    let cached = if include_contents {
        cache.entry(root).or_default()
    } else {
        &mut unused_cache
    };
    let mut seen = HashSet::new();
    for (full, index) in files {
        let metadata = fs::metadata(&full).map_err(fs_error)?;
        let mtime = mtime_ms(metadata.modified().map_err(fs_error)?);
        let entry = &mut entries[index];
        entry.mtime = Some(mtime);
        if include_contents {
            seen.insert(entry.path.clone());
            let text = match cached.get(&entry.path) {
                Some(value) if value.mtime == mtime && value.size == metadata.len() => {
                    value.text.clone()
                }
                _ => String::from_utf8_lossy(&fs::read(&full).map_err(fs_error)?).into_owned(),
            };
            cached.insert(
                entry.path.clone(),
                CachedText {
                    mtime,
                    size: metadata.len(),
                    text: text.clone(),
                },
            );
            entry.text = Some(text);
        }
    }
    if include_contents {
        cached.retain(|path, _| seen.contains(path));
    }
    Ok(entries)
}
