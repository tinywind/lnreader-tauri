use std::{fs, io::ErrorKind, path::PathBuf};

use tauri::{AppHandle, Manager};

pub(crate) const MEDIA_ROOT_DIR: &str = "chapter-media";
const MEDIA_URI_PREFIX: &str = "norea-media://chapter/";

fn media_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| format!("chapter media: app data dir: {err}"))?
        .join(MEDIA_ROOT_DIR))
}

fn safe_segment(value: &str, fallback: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(96)
        .collect::<String>();

    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn chapter_dir(app: &AppHandle, chapter_id: i64) -> Result<PathBuf, String> {
    if chapter_id <= 0 {
        return Err("chapter media: invalid chapter id".to_string());
    }
    Ok(media_root(app)?.join(chapter_id.to_string()))
}

fn parse_media_src(media_src: &str) -> Result<(i64, String, String), String> {
    let payload = media_src
        .strip_prefix(MEDIA_URI_PREFIX)
        .ok_or_else(|| "chapter media: unsupported media uri".to_string())?;
    let mut parts = payload.splitn(3, '/');
    let chapter_id = parts
        .next()
        .ok_or_else(|| "chapter media: missing chapter id".to_string())?
        .parse::<i64>()
        .map_err(|err| format!("chapter media: invalid chapter id: {err}"))?;
    let cache_key = safe_segment(
        parts
            .next()
            .ok_or_else(|| "chapter media: missing cache key".to_string())?,
        "cache",
    );
    let file_name = safe_segment(
        parts
            .next()
            .ok_or_else(|| "chapter media: missing file name".to_string())?,
        "media",
    );
    Ok((chapter_id, cache_key, file_name))
}

pub(crate) fn chapter_media_path_from_src(
    app: &AppHandle,
    media_src: &str,
) -> Result<PathBuf, String> {
    let (chapter_id, cache_key, file_name) = parse_media_src(media_src)?;
    Ok(chapter_dir(app, chapter_id)?
        .join(cache_key)
        .join(file_name))
}

pub(crate) fn chapter_media_backup_entry_name(
    media_src: &str,
) -> Result<String, String> {
    let (chapter_id, cache_key, file_name) = parse_media_src(media_src)?;
    Ok(format!(
        "{MEDIA_ROOT_DIR}/{chapter_id}/{cache_key}/{file_name}"
    ))
}

pub(crate) fn chapter_media_src_from_backup_entry(
    entry_name: &str,
) -> Option<String> {
    let rest = entry_name.strip_prefix(&format!("{MEDIA_ROOT_DIR}/"))?;
    let mut parts = rest.split('/');
    let chapter_id = parts.next()?.parse::<i64>().ok()?;
    if chapter_id <= 0 {
        return None;
    }
    let cache_key = parts.next()?;
    let file_name = parts.next()?;
    if parts.next().is_some() || cache_key.is_empty() || file_name.is_empty() {
        return None;
    }
    Some(format!(
        "{MEDIA_URI_PREFIX}{chapter_id}/{}/{}",
        safe_segment(cache_key, "cache"),
        safe_segment(file_name, "media")
    ))
}

#[tauri::command]
pub fn chapter_media_store(
    app: AppHandle,
    chapter_id: i64,
    cache_key: String,
    file_name: String,
    body: Vec<u8>,
) -> Result<String, String> {
    let cache_key = safe_segment(&cache_key, "cache");
    let file_name = safe_segment(&file_name, "media");
    let dir = chapter_dir(&app, chapter_id)?.join(&cache_key);
    fs::create_dir_all(&dir)
        .map_err(|err| format!("chapter media: create dir: {err}"))?;
    fs::write(dir.join(&file_name), body)
        .map_err(|err| format!("chapter media: write media file: {err}"))?;
    Ok(format!(
        "{MEDIA_URI_PREFIX}{chapter_id}/{cache_key}/{file_name}"
    ))
}

#[tauri::command]
pub fn chapter_media_path(app: AppHandle, media_src: String) -> Result<String, String> {
    let path = chapter_media_path_from_src(&app, &media_src)?;
    if !path.is_file() {
        return Err("chapter media: file not found".to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn chapter_media_total_size(
    app: AppHandle,
    media_srcs: Vec<String>,
) -> Result<u64, String> {
    let mut total = 0;
    for media_src in media_srcs {
        let path = chapter_media_path_from_src(&app, &media_src)?;
        match fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => {
                total += metadata.len();
            }
            Ok(_) => {}
            Err(err) if err.kind() == ErrorKind::NotFound => {}
            Err(err) => {
                return Err(format!("chapter media: read media metadata: {err}"));
            }
        }
    }
    Ok(total)
}

#[tauri::command]
pub fn chapter_media_prune(
    app: AppHandle,
    chapter_id: i64,
    keep_cache_key: String,
) -> Result<(), String> {
    let dir = chapter_dir(&app, chapter_id)?;
    if !dir.is_dir() {
        return Ok(());
    }

    let keep_cache_key = safe_segment(&keep_cache_key, "cache");
    for entry in fs::read_dir(&dir)
        .map_err(|err| format!("chapter media: read dir: {err}"))?
    {
        let entry =
            entry.map_err(|err| format!("chapter media: read entry: {err}"))?;
        if entry.file_name().to_string_lossy() == keep_cache_key {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            fs::remove_dir_all(&path)
                .map_err(|err| format!("chapter media: remove cache dir: {err}"))?;
        } else {
            fs::remove_file(&path)
                .map_err(|err| format!("chapter media: remove cache file: {err}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn chapter_media_clear(app: AppHandle, chapter_id: i64) -> Result<(), String> {
    let dir = chapter_dir(&app, chapter_id)?;
    if dir.exists() {
        fs::remove_dir_all(dir)
            .map_err(|err| format!("chapter media: remove chapter dir: {err}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn chapter_media_clear_all(app: AppHandle) -> Result<(), String> {
    let dir = media_root(&app)?;
    if dir.exists() {
        fs::remove_dir_all(dir)
            .map_err(|err| format!("chapter media: remove media root: {err}"))?;
    }
    Ok(())
}
