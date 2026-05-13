use std::{
    collections::HashSet,
    fs::{self, File},
    io::{self, BufReader, BufWriter, ErrorKind},
    path::{Component, Path, PathBuf},
};

use tauri::{AppHandle, Manager};
use zip::result::ZipError;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub(crate) const MEDIA_ROOT_DIR: &str = "chapter-media";
const MEDIA_URI_PREFIX: &str = "norea-media://chapter/";
const CONTENTS_ROOT_DIR: &str = "contents";
const EXTRACTED_CACHE_DIR: &str = ".extracted";
const MEDIA_DOWNLOAD_DIR: &str = "media";
const STORAGE_MANIFEST_FILE: &str = "storage-manifest.json";
const STORAGE_ROOT_CONFIG_FILE: &str = "chapter-media-storage-root.txt";

fn legacy_media_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| format!("chapter media: app data dir: {err}"))?
        .join(MEDIA_ROOT_DIR))
}

fn storage_root_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|err| format!("chapter media: app config dir: {err}"))?
        .join(STORAGE_ROOT_CONFIG_FILE))
}

fn configured_media_root(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let config_path = storage_root_config_path(app)?;
    match fs::read_to_string(&config_path) {
        Ok(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(PathBuf::from(trimmed)))
            }
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("chapter media: read storage root: {err}")),
    }
}

fn media_root(app: &AppHandle) -> Result<PathBuf, String> {
    configured_media_root(app)?.map_or_else(|| legacy_media_root(app), Ok)
}

fn save_configured_media_root(app: &AppHandle, root_path: &Path) -> Result<String, String> {
    let root_value = root_path.to_string_lossy().into_owned();
    if !root_value.starts_with("content://") {
        fs::create_dir_all(root_path)
            .map_err(|err| format!("chapter media: create storage root: {err}"))?;
    }
    let config_path = storage_root_config_path(app)?;
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("chapter media: create config dir: {err}"))?;
    }
    fs::write(&config_path, &root_value)
        .map_err(|err| format!("chapter media: write storage root: {err}"))?;
    Ok(root_value)
}

fn media_roots_for_lookup(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    roots.push(media_root(app)?);
    let legacy_root = legacy_media_root(app)?;
    if !roots.iter().any(|root| root == &legacy_root) {
        roots.push(legacy_root);
    }
    Ok(roots)
}

#[tauri::command]
pub fn chapter_media_get_storage_root(app: AppHandle) -> Result<Option<String>, String> {
    configured_media_root(&app).map(|root| root.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn chapter_media_set_storage_root(app: AppHandle, root: String) -> Result<String, String> {
    let trimmed = root.trim();
    if trimmed.is_empty() {
        return Err("chapter media: storage root is empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("chapter media: storage root contains an invalid character".to_string());
    }

    let root_path = PathBuf::from(trimmed);
    save_configured_media_root(&app, &root_path)
}

#[tauri::command]
pub fn chapter_media_use_default_storage_root(app: AppHandle) -> Result<String, String> {
    let root_path = legacy_media_root(&app)?;
    save_configured_media_root(&app, &root_path)
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

fn is_unsafe_unicode_format(ch: char) -> bool {
    matches!(
        ch,
        '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{206F}'
            | '\u{FEFF}'
    )
}

fn safe_label_segment(value: Option<&str>, fallback: &str) -> String {
    let raw = value.map(str::trim).filter(|value| !value.is_empty());
    let sanitized = raw
        .unwrap_or(fallback)
        .chars()
        .map(|ch| {
            if ch.is_control()
                || ch.is_whitespace()
                || is_unsafe_unicode_format(ch)
                || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '-'
            } else {
                ch
            }
        })
        .collect::<String>()
        .trim_matches(['-', '.'])
        .chars()
        .take(96)
        .collect::<String>();

    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn novel_folder_segment(
    novel_name: Option<&str>,
    novel_path: Option<&str>,
    novel_id: i64,
) -> String {
    let novel_address = safe_segment(
        novel_path.unwrap_or_default(),
        &novel_id.to_string(),
    );
    format!(
        "{}-{novel_address}",
        safe_label_segment(novel_name, "novel")
    )
}

fn chapter_number_segment(
    chapter_number: Option<&str>,
    position: Option<i64>,
    chapter_id: i64,
) -> String {
    let fallback = position
        .filter(|value| *value > 0)
        .map(|value| value.to_string())
        .unwrap_or_else(|| chapter_id.to_string());
    safe_segment(chapter_number.unwrap_or_default(), &fallback)
}

fn chapter_folder_segment(
    chapter_number: Option<&str>,
    chapter_name: Option<&str>,
    position: Option<i64>,
    chapter_id: i64,
) -> String {
    format!(
        "{}-{}",
        chapter_number_segment(chapter_number, position, chapter_id),
        safe_label_segment(chapter_name, "chapter")
    )
}

fn chapter_dir_at(root: &Path, chapter_id: i64) -> Result<PathBuf, String> {
    if chapter_id <= 0 {
        return Err("chapter media: invalid chapter id".to_string());
    }
    Ok(root.join(chapter_id.to_string()))
}

fn content_chapter_dir_at(
    root: &Path,
    source_id: &str,
    novel_id: i64,
    novel_path: Option<&str>,
    novel_name: Option<&str>,
    chapter_id: i64,
    chapter_number: Option<&str>,
    chapter_name: Option<&str>,
    chapter_position: Option<i64>,
) -> Result<PathBuf, String> {
    if novel_id <= 0 {
        return Err("chapter media: invalid novel id".to_string());
    }
    if chapter_id <= 0 {
        return Err("chapter media: invalid chapter id".to_string());
    }
    let source_id = safe_segment(source_id, "source");
    let novel_segment = novel_folder_segment(novel_name, novel_path, novel_id);
    let chapter_segment =
        chapter_folder_segment(chapter_number, chapter_name, chapter_position, chapter_id);
    Ok(root
        .join(CONTENTS_ROOT_DIR)
        .join(source_id)
        .join(novel_segment)
        .join(chapter_segment))
}

fn content_chapter_relative_dir(
    source_id: &str,
    novel_id: i64,
    novel_path: Option<&str>,
    novel_name: Option<&str>,
    chapter_id: i64,
    chapter_number: Option<&str>,
    chapter_name: Option<&str>,
    chapter_position: Option<i64>,
) -> Result<String, String> {
    let dir = content_chapter_dir_at(
        Path::new(""),
        source_id,
        novel_id,
        novel_path,
        novel_name,
        chapter_id,
        chapter_number,
        chapter_name,
        chapter_position,
    )?;
    Ok(dir.to_string_lossy().replace('\\', "/"))
}

fn path_segment_has_id_suffix(path: &Path, id: i64) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.ends_with(&format!("-{id}")))
}

fn content_chapter_dirs_for_lookup(root: &Path, chapter_id: i64) -> Result<Vec<PathBuf>, String> {
    if chapter_id <= 0 {
        return Err("chapter media: invalid chapter id".to_string());
    }

    let contents_dir = root.join(CONTENTS_ROOT_DIR);
    if !contents_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut dirs = Vec::new();
    for source_entry in
        fs::read_dir(&contents_dir).map_err(|err| format!("chapter media: read contents: {err}"))?
    {
        let source_entry =
            source_entry.map_err(|err| format!("chapter media: read contents entry: {err}"))?;
        let source_dir = source_entry.path();
        if !source_dir.is_dir() {
            continue;
        }
        for novel_entry in fs::read_dir(&source_dir)
            .map_err(|err| format!("chapter media: read source contents: {err}"))?
        {
            let novel_entry =
                novel_entry.map_err(|err| format!("chapter media: read source entry: {err}"))?;
            let novel_dir = novel_entry.path();
            if !novel_dir.is_dir() {
                continue;
            }
            for chapter_entry in fs::read_dir(&novel_dir)
                .map_err(|err| format!("chapter media: read novel contents: {err}"))?
            {
                let chapter_entry = chapter_entry
                    .map_err(|err| format!("chapter media: read novel entry: {err}"))?;
                let chapter_dir = chapter_entry.path();
                if chapter_dir.is_dir() && path_segment_has_id_suffix(&chapter_dir, chapter_id) {
                    dirs.push(chapter_dir);
                }
            }
        }
    }
    dirs.sort();
    Ok(dirs)
}

fn storage_manifest_path(root: &Path) -> PathBuf {
    root.join(STORAGE_MANIFEST_FILE)
}

fn safe_relative_storage_path(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if path.is_absolute() {
        return Err("chapter media: storage path must be relative".to_string());
    }
    for component in path.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err("chapter media: invalid storage path".to_string()),
        }
    }
    Ok(path)
}

fn chapter_content_extension(content_type: Option<&str>) -> &'static str {
    match content_type {
        Some("pdf") => "pdf",
        Some("text") => "txt",
        _ => "html",
    }
}

fn chapter_content_relative_path(
    source_id: &str,
    novel_id: i64,
    novel_path: Option<&str>,
    novel_name: Option<&str>,
    chapter_id: i64,
    chapter_number: Option<&str>,
    chapter_name: Option<&str>,
    chapter_position: Option<i64>,
    extension: &str,
) -> Result<String, String> {
    Ok(format!(
        "{}/content.{extension}",
        content_chapter_relative_dir(
            source_id,
            novel_id,
            novel_path,
            novel_name,
            chapter_id,
            chapter_number,
            chapter_name,
            chapter_position,
        )?
    ))
}

fn chapter_archive_path_at(
    root: &Path,
    source_id: &str,
    novel_id: i64,
    novel_path: Option<&str>,
    novel_name: Option<&str>,
    chapter_id: i64,
    chapter_number: Option<&str>,
    chapter_name: Option<&str>,
    chapter_position: Option<i64>,
    cache_key: &str,
) -> Result<PathBuf, String> {
    Ok(content_chapter_dir_at(
        root,
        source_id,
        novel_id,
        novel_path,
        novel_name,
        chapter_id,
        chapter_number,
        chapter_name,
        chapter_position,
    )?
    .join(format!("{cache_key}.zip")))
}

fn chapter_archives_in_dir(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut archives = Vec::new();
    for entry in fs::read_dir(dir).map_err(|err| format!("chapter media: read dir: {err}"))? {
        let entry = entry.map_err(|err| format!("chapter media: read entry: {err}"))?;
        let path = entry.path();
        if path.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            archives.push(path);
        }
    }
    archives.sort();
    Ok(archives)
}

fn clear_content_media_artifacts(chapter_dir: &Path) -> Result<(), String> {
    let media_dir = chapter_dir.join(MEDIA_DOWNLOAD_DIR);
    if media_dir.exists() {
        fs::remove_dir_all(&media_dir)
            .map_err(|err| format!("chapter media: remove media dir: {err}"))?;
    }
    let extracted_dir = chapter_dir.join(EXTRACTED_CACHE_DIR);
    if extracted_dir.exists() {
        fs::remove_dir_all(&extracted_dir)
            .map_err(|err| format!("chapter media: remove extracted dir: {err}"))?;
    }
    for archive_path in chapter_archives_in_dir(chapter_dir)? {
        fs::remove_file(&archive_path)
            .map_err(|err| format!("chapter media: remove media archive: {err}"))?;
    }
    Ok(())
}

fn read_storage_manifest(path: &Path) -> Result<serde_json::Value, String> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|err| format!("chapter media: parse storage manifest: {err}")),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(serde_json::json!({
            "version": 1,
            "contentRoot": CONTENTS_ROOT_DIR,
            "novels": {},
            "chapters": {}
        })),
        Err(err) => Err(format!("chapter media: read storage manifest: {err}")),
    }
}

fn manifest_object_mut<'a>(
    manifest: &'a mut serde_json::Value,
    key: &str,
) -> Result<&'a mut serde_json::Map<String, serde_json::Value>, String> {
    if !manifest.is_object() {
        *manifest = serde_json::json!({
            "version": 1,
            "contentRoot": CONTENTS_ROOT_DIR,
            "novels": {},
            "chapters": {}
        });
    }
    let object = manifest
        .as_object_mut()
        .ok_or_else(|| "chapter media: storage manifest is not an object".to_string())?;
    object
        .entry(key.to_string())
        .or_insert_with(|| serde_json::json!({}));
    object
        .get_mut(key)
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| format!("chapter media: storage manifest {key} is not an object"))
}

fn write_storage_manifest(path: &Path, manifest: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("chapter media: create manifest dir: {err}"))?;
    }
    let temp_path = path.with_extension("json.tmp");
    let body = serde_json::to_vec_pretty(manifest)
        .map_err(|err| format!("chapter media: encode storage manifest: {err}"))?;
    fs::write(&temp_path, body)
        .map_err(|err| format!("chapter media: write storage manifest temp: {err}"))?;
    fs::rename(&temp_path, path)
        .map_err(|err| format!("chapter media: move storage manifest: {err}"))
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

fn content_chapter_dir_from_context(
    root: &Path,
    novel_id: Option<i64>,
    source_id: Option<&str>,
    novel_path: Option<&str>,
    novel_name: Option<&str>,
    chapter_id: i64,
    chapter_number: Option<&str>,
    chapter_name: Option<&str>,
    chapter_position: Option<i64>,
) -> Result<Option<PathBuf>, String> {
    let Some(novel_id) = novel_id else {
        return Ok(None);
    };
    let Some(source_id) = source_id else {
        return Ok(None);
    };
    let Some(novel_path) = novel_path else {
        return Ok(None);
    };
    Ok(Some(content_chapter_dir_at(
        root,
        source_id,
        novel_id,
        Some(novel_path),
        novel_name,
        chapter_id,
        chapter_number,
        chapter_name,
        chapter_position,
    )?))
}

fn media_path_in_chapter_dir(
    chapter_dir: &Path,
    cache_key: &str,
    file_name: &str,
) -> Option<PathBuf> {
    let current_path = chapter_dir
        .join(MEDIA_DOWNLOAD_DIR)
        .join(cache_key)
        .join(file_name);
    if current_path.is_file() {
        return Some(current_path);
    }

    let legacy_path = chapter_dir.join(MEDIA_DOWNLOAD_DIR).join(file_name);
    if legacy_path.is_file() {
        return Some(legacy_path);
    }

    None
}

fn media_path_from_chapter_dir(
    chapter_dir: &Path,
    cache_key: &str,
    file_name: &str,
) -> Result<Option<PathBuf>, String> {
    if let Some(path) = media_path_in_chapter_dir(chapter_dir, cache_key, file_name) {
        return Ok(Some(path));
    }

    let output_dir = chapter_dir.join(EXTRACTED_CACHE_DIR).join(cache_key);
    for archive_path in chapter_archives_in_dir(chapter_dir)? {
        if let Some(path) =
            extract_chapter_media_file_from_archive(&archive_path, &output_dir, file_name)?
        {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

fn chapter_media_path_from_src_with_context(
    app: &AppHandle,
    media_src: &str,
    novel_id: Option<i64>,
    source_id: Option<&str>,
    novel_path: Option<&str>,
    novel_name: Option<&str>,
    chapter_number: Option<&str>,
    chapter_name: Option<&str>,
    chapter_position: Option<i64>,
) -> Result<PathBuf, String> {
    let (chapter_id, cache_key, file_name) = parse_media_src(media_src)?;
    let roots = media_roots_for_lookup(app)?;
    for root in &roots {
        if let Some(chapter_dir) = content_chapter_dir_from_context(
            root,
            novel_id,
            source_id,
            novel_path,
            novel_name,
            chapter_id,
            chapter_number,
            chapter_name,
            chapter_position,
        )? {
            if let Some(path) = media_path_from_chapter_dir(&chapter_dir, &cache_key, &file_name)? {
                return Ok(path);
            }
        }

        for chapter_dir in content_chapter_dirs_for_lookup(root, chapter_id)? {
            if let Some(path) = media_path_from_chapter_dir(&chapter_dir, &cache_key, &file_name)? {
                return Ok(path);
            }
        }
    }

    Ok(chapter_dir_at(&roots[0], chapter_id)?
        .join(&cache_key)
        .join(&file_name))
}

pub(crate) fn chapter_media_src_from_backup_entry(entry_name: &str) -> Option<String> {
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
    novel_id: Option<i64>,
    source_id: Option<String>,
    novel_name: Option<String>,
    novel_path: Option<String>,
    chapter_number: Option<String>,
    chapter_name: Option<String>,
    chapter_position: Option<i64>,
) -> Result<String, String> {
    let cache_key = safe_segment(&cache_key, "cache");
    let file_name = safe_segment(&file_name, "media");
    let novel_id = novel_id.ok_or_else(|| "chapter media: missing novel id".to_string())?;
    let source_id = source_id
        .as_deref()
        .ok_or_else(|| "chapter media: missing source id".to_string())?;
    let root = media_root(&app)?;
    let dir = content_chapter_dir_at(
        &root,
        source_id,
        novel_id,
        novel_path.as_deref(),
        novel_name.as_deref(),
        chapter_id,
        chapter_number.as_deref(),
        chapter_name.as_deref(),
        chapter_position,
    )?
    .join(MEDIA_DOWNLOAD_DIR)
    .join(&cache_key);
    fs::create_dir_all(&dir).map_err(|err| format!("chapter media: create dir: {err}"))?;
    fs::write(dir.join(&file_name), body)
        .map_err(|err| format!("chapter media: write media file: {err}"))?;
    Ok(format!(
        "{MEDIA_URI_PREFIX}{chapter_id}/{cache_key}/{file_name}"
    ))
}

fn archive_cache_entry_paths(dir: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|err| format!("chapter media: read cache dir: {err}"))? {
        let entry = entry.map_err(|err| format!("chapter media: read cache entry: {err}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = safe_segment(&entry.file_name().to_string_lossy(), "media");
        entries.push((file_name, path));
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(entries)
}

fn archive_candidates_for_cache(
    app: &AppHandle,
    chapter_id: i64,
    cache_key: &str,
    novel_id: i64,
    source_id: &str,
    novel_path: Option<&str>,
    novel_name: Option<&str>,
    chapter_number: Option<&str>,
    chapter_name: Option<&str>,
    chapter_position: Option<i64>,
) -> Result<Vec<PathBuf>, String> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for root in media_roots_for_lookup(app)? {
        let current_path = chapter_archive_path_at(
            &root,
            source_id,
            novel_id,
            novel_path,
            novel_name,
            chapter_id,
            chapter_number,
            chapter_name,
            chapter_position,
            cache_key,
        )?;
        if seen.insert(current_path.clone()) {
            candidates.push(current_path);
        }

        for chapter_dir in content_chapter_dirs_for_lookup(&root, chapter_id)? {
            for path in chapter_archives_in_dir(&chapter_dir)? {
                if seen.insert(path.clone()) {
                    candidates.push(path);
                }
            }
        }
    }
    Ok(candidates)
}

#[tauri::command]
pub fn chapter_media_archive_cache(
    app: AppHandle,
    chapter_id: i64,
    cache_key: String,
    novel_id: Option<i64>,
    source_id: Option<String>,
    novel_name: Option<String>,
    novel_path: Option<String>,
    chapter_number: Option<String>,
    chapter_name: Option<String>,
    chapter_position: Option<i64>,
) -> Result<u64, String> {
    let cache_key = safe_segment(&cache_key, "cache");
    let novel_id = novel_id.ok_or_else(|| "chapter media: missing novel id".to_string())?;
    let source_id = source_id
        .as_deref()
        .ok_or_else(|| "chapter media: missing source id".to_string())?;
    let media_root = media_root(&app)?;
    let chapter_dir = content_chapter_dir_at(
        &media_root,
        source_id,
        novel_id,
        novel_path.as_deref(),
        novel_name.as_deref(),
        chapter_id,
        chapter_number.as_deref(),
        chapter_name.as_deref(),
        chapter_position,
    )?;
    let archive_path = chapter_archive_path_at(
        &media_root,
        source_id,
        novel_id,
        novel_path.as_deref(),
        novel_name.as_deref(),
        chapter_id,
        chapter_number.as_deref(),
        chapter_name.as_deref(),
        chapter_position,
        &cache_key,
    )?;
    let cache_dir = chapter_dir.join(MEDIA_DOWNLOAD_DIR).join(&cache_key);
    let extracted_dir = chapter_dir.join(EXTRACTED_CACHE_DIR).join(&cache_key);

    if !cache_dir.is_dir() {
        for candidate in archive_candidates_for_cache(
            &app,
            chapter_id,
            &cache_key,
            novel_id,
            source_id,
            novel_path.as_deref(),
            novel_name.as_deref(),
            chapter_number.as_deref(),
            chapter_name.as_deref(),
            chapter_position,
        )? {
            match fs::metadata(&candidate) {
                Ok(metadata) if metadata.is_file() => return Ok(metadata.len()),
                Ok(_) => {}
                Err(err) if err.kind() == ErrorKind::NotFound => {}
                Err(err) => {
                    return Err(format!("chapter media: read archive metadata: {err}"));
                }
            }
        }
        return Ok(0);
    }

    let entries = archive_cache_entry_paths(&cache_dir)?;
    if entries.is_empty() {
        fs::remove_dir_all(&cache_dir)
            .map_err(|err| format!("chapter media: remove empty cache dir: {err}"))?;
        for candidate in archive_candidates_for_cache(
            &app,
            chapter_id,
            &cache_key,
            novel_id,
            source_id,
            novel_path.as_deref(),
            novel_name.as_deref(),
            chapter_number.as_deref(),
            chapter_name.as_deref(),
            chapter_position,
        )? {
            match fs::metadata(&candidate) {
                Ok(metadata) if metadata.is_file() => return Ok(metadata.len()),
                Ok(_) => {}
                Err(err) if err.kind() == ErrorKind::NotFound => {}
                Err(err) => {
                    return Err(format!("chapter media: read archive metadata: {err}"));
                }
            }
        }
        return Ok(0);
    }

    fs::create_dir_all(&chapter_dir)
        .map_err(|err| format!("chapter media: create chapter dir: {err}"))?;
    let temp_archive_path = chapter_dir.join(format!("{cache_key}.zip.tmp"));
    let temp_file = File::create(&temp_archive_path)
        .map_err(|err| format!("chapter media: create archive: {err}"))?;
    let mut archive = ZipWriter::new(BufWriter::new(temp_file));
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let new_entry_names = entries
        .iter()
        .map(|(entry_name, _)| entry_name.clone())
        .collect::<HashSet<_>>();
    let mut written_entry_names = HashSet::new();

    if let Some(previous_archive_path) = archive_candidates_for_cache(
        &app,
        chapter_id,
        &cache_key,
        novel_id,
        source_id,
        novel_path.as_deref(),
        novel_name.as_deref(),
        chapter_number.as_deref(),
        chapter_name.as_deref(),
        chapter_position,
    )?
    .into_iter()
    .find(|path| path.is_file())
    {
        let previous_archive_file = File::open(&previous_archive_path)
            .map_err(|err| format!("chapter media: open previous archive: {err}"))?;
        let mut previous_archive = ZipArchive::new(BufReader::new(previous_archive_file))
            .map_err(|err| format!("chapter media: read previous archive: {err}"))?;
        for index in 0..previous_archive.len() {
            let mut entry = previous_archive
                .by_index(index)
                .map_err(|err| format!("chapter media: open previous archive entry: {err}"))?;
            if !entry.is_file() {
                continue;
            }
            let entry_name = safe_segment(entry.name(), "media");
            if new_entry_names.contains(&entry_name)
                || !written_entry_names.insert(entry_name.clone())
            {
                continue;
            }
            archive
                .start_file(&entry_name, options)
                .map_err(|err| format!("chapter media: start previous archive entry: {err}"))?;
            io::copy(&mut entry, &mut archive)
                .map_err(|err| format!("chapter media: copy previous archive entry: {err}"))?;
        }
    }

    for (entry_name, path) in entries {
        if !written_entry_names.insert(entry_name.clone()) {
            continue;
        }
        archive
            .start_file(&entry_name, options)
            .map_err(|err| format!("chapter media: start archive entry: {err}"))?;
        let mut input =
            File::open(&path).map_err(|err| format!("chapter media: open cache file: {err}"))?;
        io::copy(&mut input, &mut archive)
            .map_err(|err| format!("chapter media: write archive entry: {err}"))?;
    }

    archive
        .finish()
        .map_err(|err| format!("chapter media: finalize archive: {err}"))?;
    if archive_path.exists() {
        fs::remove_file(&archive_path)
            .map_err(|err| format!("chapter media: replace archive: {err}"))?;
    }
    fs::rename(&temp_archive_path, &archive_path)
        .map_err(|err| format!("chapter media: move archive: {err}"))?;
    fs::remove_dir_all(&cache_dir)
        .map_err(|err| format!("chapter media: remove cache dir: {err}"))?;

    if extracted_dir.exists() {
        fs::remove_dir_all(&extracted_dir)
            .map_err(|err| format!("chapter media: clear extracted cache: {err}"))?;
    }

    for root in media_roots_for_lookup(&app)? {
        for old_chapter_dir in content_chapter_dirs_for_lookup(&root, chapter_id)? {
            if old_chapter_dir != chapter_dir {
                clear_content_media_artifacts(&old_chapter_dir)?;
            }
        }
    }

    fs::metadata(&archive_path)
        .map(|metadata| metadata.len())
        .map_err(|err| format!("chapter media: read archive size: {err}"))
}

#[tauri::command]
pub fn chapter_content_mirror_store(
    app: AppHandle,
    chapter_id: i64,
    content: String,
    metadata: serde_json::Value,
) -> Result<(), String> {
    let media_root = media_root(&app)?;
    let novel = metadata
        .get("novel")
        .cloned()
        .ok_or_else(|| "chapter media: missing novel metadata".to_string())?;
    let mut chapter = metadata
        .get("chapter")
        .cloned()
        .ok_or_else(|| "chapter media: missing chapter metadata".to_string())?;
    let novel_id = novel
        .get("id")
        .and_then(serde_json::Value::as_i64)
        .ok_or_else(|| "chapter media: invalid novel metadata id".to_string())?;
    let source_id = novel
        .get("pluginId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "chapter media: invalid novel metadata plugin id".to_string())?;
    let novel_name = novel.get("name").and_then(serde_json::Value::as_str);
    let novel_path = novel.get("path").and_then(serde_json::Value::as_str);
    let chapter_number = chapter
        .get("chapterNumber")
        .and_then(serde_json::Value::as_str);
    let chapter_name = chapter.get("name").and_then(serde_json::Value::as_str);
    let position = chapter.get("position").and_then(serde_json::Value::as_i64);
    let content_type = chapter
        .get("contentType")
        .and_then(serde_json::Value::as_str);
    let extension = chapter_content_extension(content_type);
    let content_file = chapter_content_relative_path(
        source_id,
        novel_id,
        novel_path,
        novel_name,
        chapter_id,
        chapter_number,
        chapter_name,
        position,
        extension,
    )?;
    let content_path = media_root.join(&content_file);

    let manifest_path = storage_manifest_path(&media_root);
    let mut manifest = read_storage_manifest(&manifest_path)?;
    let chapter_key = chapter_id.to_string();
    let previous_content_file = manifest
        .get("chapters")
        .and_then(|chapters| chapters.get(chapter_key.as_str()))
        .and_then(|chapter| chapter.get("contentFile"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);

    if let Some(parent) = content_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("chapter media: create content mirror dir: {err}"))?;
    }
    let temp_content_path = content_path.with_extension(format!("{extension}.tmp"));
    fs::write(&temp_content_path, content)
        .map_err(|err| format!("chapter media: write content mirror temp: {err}"))?;
    fs::rename(&temp_content_path, &content_path)
        .map_err(|err| format!("chapter media: move content mirror: {err}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    if let Some(object) = manifest.as_object_mut() {
        object.insert("version".to_string(), serde_json::json!(1));
        object.insert("updatedAt".to_string(), serde_json::json!(now));
        object.insert(
            "contentRoot".to_string(),
            serde_json::json!(CONTENTS_ROOT_DIR),
        );
    }

    if let Some(chapter_object) = chapter.as_object_mut() {
        chapter_object.insert(
            "contentFile".to_string(),
            serde_json::json!(content_file.clone()),
        );
    }

    manifest_object_mut(&mut manifest, "novels")?.insert(novel_id.to_string(), novel);
    manifest_object_mut(&mut manifest, "chapters")?.insert(chapter_key, chapter);
    if let Some(previous_content_file) = previous_content_file {
        if previous_content_file != content_file {
            let previous_content_path = media_root.join(previous_content_file);
            if previous_content_path.exists() {
                fs::remove_file(&previous_content_path).map_err(|err| {
                    format!("chapter media: remove previous content mirror: {err}")
                })?;
            }
        }
    }
    write_storage_manifest(&manifest_path, &manifest)
}

#[tauri::command]
pub fn chapter_content_mirror_clear(app: AppHandle, chapter_id: i64) -> Result<(), String> {
    let media_root = media_root(&app)?;
    let manifest_path = storage_manifest_path(&media_root);
    if manifest_path.exists() {
        let mut manifest = read_storage_manifest(&manifest_path)?;
        if let Ok(chapters) = manifest_object_mut(&mut manifest, "chapters") {
            if let Some(chapter) = chapters.remove(&chapter_id.to_string()) {
                if let Some(content_file) = chapter
                    .get("contentFile")
                    .and_then(serde_json::Value::as_str)
                {
                    let content_path = media_root.join(content_file);
                    if content_path.exists() {
                        fs::remove_file(&content_path).map_err(|err| {
                            format!("chapter media: remove content mirror: {err}")
                        })?;
                    }
                }
            }
        }
        write_storage_manifest(&manifest_path, &manifest)?;
    }

    for chapter_dir in content_chapter_dirs_for_lookup(&media_root, chapter_id)? {
        for extension in ["html", "txt", "pdf"] {
            for entry in fs::read_dir(&chapter_dir)
                .map_err(|err| format!("chapter media: read dir: {err}"))?
            {
                let entry = entry.map_err(|err| format!("chapter media: read entry: {err}"))?;
                let path = entry.path();
                if path.is_file()
                    && path
                        .extension()
                        .and_then(|value| value.to_str())
                        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
                    && path
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .is_some_and(|value| value == "content" || value.starts_with("chapter"))
                {
                    fs::remove_file(path)
                        .map_err(|err| format!("chapter media: remove content mirror: {err}"))?;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn chapter_content_mirror_read(app: AppHandle) -> Result<serde_json::Value, String> {
    let media_root = media_root(&app)?;
    let manifest_path = storage_manifest_path(&media_root);
    let mut manifest = read_storage_manifest(&manifest_path)?;
    let chapters = manifest_object_mut(&mut manifest, "chapters")?;
    for chapter in chapters.values_mut() {
        let content_file = chapter
            .get("contentFile")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "chapter media: mirrored chapter missing content file".to_string())?;
        let content_path = media_root.join(content_file);
        let content = fs::read_to_string(&content_path).map_err(|err| {
            format!(
                "chapter media: read mirrored chapter '{}': {err}",
                content_path.to_string_lossy()
            )
        })?;
        if let Some(chapter_object) = chapter.as_object_mut() {
            chapter_object.insert("content".to_string(), serde_json::json!(content));
        }
    }
    Ok(manifest)
}

#[tauri::command]
pub fn chapter_content_mirror_read_file(
    app: AppHandle,
    content_file: String,
) -> Result<Option<String>, String> {
    let media_root = media_root(&app)?;
    let relative_path = safe_relative_storage_path(&content_file)?;
    let content_path = media_root.join(relative_path);
    match fs::read_to_string(&content_path) {
        Ok(content) => Ok(Some(content)),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!(
            "chapter media: read mirrored chapter '{}': {err}",
            content_path.to_string_lossy()
        )),
    }
}

fn extract_chapter_media_file_from_archive(
    archive_path: &Path,
    output_dir: &Path,
    file_name: &str,
) -> Result<Option<PathBuf>, String> {
    let output_path = output_dir.join(file_name);
    if output_path.is_file() {
        return Ok(Some(output_path));
    }

    let archive_file =
        File::open(archive_path).map_err(|err| format!("chapter media: open archive: {err}"))?;
    let mut archive = ZipArchive::new(BufReader::new(archive_file))
        .map_err(|err| format!("chapter media: read archive: {err}"))?;
    let mut entry = match archive.by_name(file_name) {
        Ok(entry) => entry,
        Err(ZipError::FileNotFound) => return Ok(None),
        Err(err) => return Err(format!("chapter media: open archive entry: {err}")),
    };
    if !entry.is_file() {
        return Err("chapter media: archive entry is not a file".to_string());
    }

    fs::create_dir_all(&output_dir)
        .map_err(|err| format!("chapter media: create extracted dir: {err}"))?;
    let temp_output_path = output_dir.join(format!("{file_name}.tmp"));
    let mut output_file = File::create(&temp_output_path)
        .map_err(|err| format!("chapter media: create extracted file: {err}"))?;
    io::copy(&mut entry, &mut output_file)
        .map_err(|err| format!("chapter media: extract archive entry: {err}"))?;
    drop(output_file);
    if output_path.exists() {
        fs::remove_file(&output_path)
            .map_err(|err| format!("chapter media: replace extracted file: {err}"))?;
    }
    fs::rename(&temp_output_path, &output_path)
        .map_err(|err| format!("chapter media: move extracted file: {err}"))?;
    Ok(Some(output_path))
}

fn archive_contains_file(archive_path: &Path, file_name: &str) -> Result<bool, String> {
    let archive_file =
        File::open(archive_path).map_err(|err| format!("chapter media: open archive: {err}"))?;
    let mut archive = ZipArchive::new(BufReader::new(archive_file))
        .map_err(|err| format!("chapter media: read archive: {err}"))?;
    let contains_file = match archive.by_name(file_name) {
        Ok(entry) => Ok(entry.is_file()),
        Err(ZipError::FileNotFound) => Ok(false),
        Err(err) => Err(format!("chapter media: open archive entry: {err}")),
    };
    contains_file
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);

        output.push(TABLE[(first >> 2) as usize] as char);
        output.push(TABLE[(((first & 0b0000_0011) << 4) | (second >> 4)) as usize] as char);
        if chunk.len() > 1 {
            output.push(TABLE[(((second & 0b0000_1111) << 2) | (third >> 6)) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(TABLE[(third & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
    }

    output
}

fn media_mime_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("apng") => "image/apng",
        Some("avif") => "image/avif",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("oga") | Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("mp4") => "video/mp4",
        Some("ogv") => "video/ogg",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

#[tauri::command]
pub fn chapter_media_path(
    app: AppHandle,
    media_src: String,
    novel_id: Option<i64>,
    source_id: Option<String>,
    novel_name: Option<String>,
    novel_path: Option<String>,
    chapter_number: Option<String>,
    chapter_name: Option<String>,
    chapter_position: Option<i64>,
) -> Result<String, String> {
    let path = chapter_media_path_from_src_with_context(
        &app,
        &media_src,
        novel_id,
        source_id.as_deref(),
        novel_path.as_deref(),
        novel_name.as_deref(),
        chapter_number.as_deref(),
        chapter_name.as_deref(),
        chapter_position,
    )?;
    if !path.is_file() {
        return Err("chapter media: file not found".to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn chapter_media_data_url(
    app: AppHandle,
    media_src: String,
    novel_id: Option<i64>,
    source_id: Option<String>,
    novel_name: Option<String>,
    novel_path: Option<String>,
    chapter_number: Option<String>,
    chapter_name: Option<String>,
    chapter_position: Option<i64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = chapter_media_path_from_src_with_context(
            &app,
            &media_src,
            novel_id,
            source_id.as_deref(),
            novel_path.as_deref(),
            novel_name.as_deref(),
            chapter_number.as_deref(),
            chapter_name.as_deref(),
            chapter_position,
        )?;
        if !path.is_file() {
            return Err("chapter media: file not found".to_string());
        }
        let body = fs::read(&path).map_err(|err| format!("chapter media: read media: {err}"))?;
        Ok(format!(
            "data:{};base64,{}",
            media_mime_type(&path),
            encode_base64(&body)
        ))
    })
    .await
    .map_err(|err| format!("chapter media: read media task: {err}"))?
}

#[tauri::command]
pub fn chapter_media_total_size(
    app: AppHandle,
    media_srcs: Vec<String>,
    novel_id: Option<i64>,
    source_id: Option<String>,
    novel_name: Option<String>,
    novel_path: Option<String>,
    chapter_number: Option<String>,
    chapter_name: Option<String>,
    chapter_position: Option<i64>,
) -> Result<u64, String> {
    let mut total = 0;
    let mut counted_archives = HashSet::new();
    for media_src in media_srcs {
        let (chapter_id, cache_key, file_name) = parse_media_src(&media_src)?;
        for root in media_roots_for_lookup(&app)? {
            let mut found = false;
            if let Some(chapter_dir) = content_chapter_dir_from_context(
                &root,
                novel_id,
                source_id.as_deref(),
                novel_path.as_deref(),
                novel_name.as_deref(),
                chapter_id,
                chapter_number.as_deref(),
                chapter_name.as_deref(),
                chapter_position,
            )? {
                if let Some(path) =
                    media_path_in_chapter_dir(&chapter_dir, &cache_key, &file_name)
                {
                    match fs::metadata(&path) {
                        Ok(metadata) if metadata.is_file() => {
                            total += metadata.len();
                            found = true;
                        }
                        Ok(_) => {}
                        Err(err) if err.kind() == ErrorKind::NotFound => {}
                        Err(err) => {
                            return Err(format!("chapter media: read media metadata: {err}"));
                        }
                    }
                }

                if !found {
                    for archive_path in chapter_archives_in_dir(&chapter_dir)? {
                        let archive_key = archive_path.to_string_lossy().into_owned();
                        if counted_archives.contains(&archive_key)
                            || !archive_contains_file(&archive_path, &file_name)?
                        {
                            continue;
                        }
                        match fs::metadata(&archive_path) {
                            Ok(metadata) if metadata.is_file() => {
                                total += metadata.len();
                                counted_archives.insert(archive_key);
                                found = true;
                                break;
                            }
                            Ok(_) => {}
                            Err(err) if err.kind() == ErrorKind::NotFound => {}
                            Err(err) => {
                                return Err(format!(
                                    "chapter media: read archive metadata: {err}"
                                ));
                            }
                        }
                    }
                }
            }

            for chapter_dir in content_chapter_dirs_for_lookup(&root, chapter_id)? {
                if found {
                    break;
                }
                if let Some(path) = media_path_in_chapter_dir(&chapter_dir, &cache_key, &file_name)
                {
                    match fs::metadata(&path) {
                        Ok(metadata) if metadata.is_file() => {
                            total += metadata.len();
                            found = true;
                            break;
                        }
                        Ok(_) => {}
                        Err(err) if err.kind() == ErrorKind::NotFound => {}
                        Err(err) => {
                            return Err(format!("chapter media: read media metadata: {err}"));
                        }
                    }
                }

                for archive_path in chapter_archives_in_dir(&chapter_dir)? {
                    let archive_key = archive_path.to_string_lossy().into_owned();
                    if counted_archives.contains(&archive_key)
                        || !archive_contains_file(&archive_path, &file_name)?
                    {
                        continue;
                    }
                    match fs::metadata(&archive_path) {
                        Ok(metadata) if metadata.is_file() => {
                            total += metadata.len();
                            counted_archives.insert(archive_key);
                            found = true;
                            break;
                        }
                        Ok(_) => {}
                        Err(err) if err.kind() == ErrorKind::NotFound => {}
                        Err(err) => {
                            return Err(format!("chapter media: read archive metadata: {err}"));
                        }
                    }
                }
                if found {
                    break;
                }
            }
            if found {
                break;
            }
        }
    }
    Ok(total)
}

fn prune_chapter_dir(dir: &Path, keep_cache_key: &str) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }

    let keep_archive_name = format!("{keep_cache_key}.zip");
    let media_dir = dir.join(MEDIA_DOWNLOAD_DIR);
    if media_dir.is_dir() {
        for entry in
            fs::read_dir(&media_dir).map_err(|err| format!("chapter media: read media dir: {err}"))?
        {
            let entry = entry.map_err(|err| format!("chapter media: read media entry: {err}"))?;
            if entry.file_name().to_string_lossy().as_ref() == keep_cache_key {
                continue;
            }
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(&path)
                    .map_err(|err| format!("chapter media: remove media cache dir: {err}"))?;
            } else {
                fs::remove_file(&path)
                    .map_err(|err| format!("chapter media: remove media cache file: {err}"))?;
            }
        }
    }

    for entry in fs::read_dir(dir).map_err(|err| format!("chapter media: read dir: {err}"))? {
        let entry = entry.map_err(|err| format!("chapter media: read entry: {err}"))?;
        let entry_name = entry.file_name().to_string_lossy().to_string();
        if entry_name == MEDIA_DOWNLOAD_DIR
            || entry_name == EXTRACTED_CACHE_DIR
            || entry_name == keep_archive_name
            || !entry_name.ends_with(".zip")
        {
            continue;
        }
        let path = entry.path();
        fs::remove_file(&path).map_err(|err| format!("chapter media: remove archive: {err}"))?;
    }
    Ok(())
}

fn clear_storage_root(root: &Path) -> Result<(), String> {
    let contents_dir = root.join(CONTENTS_ROOT_DIR);
    if contents_dir.exists() {
        fs::remove_dir_all(&contents_dir)
            .map_err(|err| format!("chapter media: remove contents dir: {err}"))?;
    }

    let manifest_path = storage_manifest_path(root);
    if manifest_path.exists() {
        fs::remove_file(&manifest_path)
            .map_err(|err| format!("chapter media: remove storage manifest: {err}"))?;
    }

    if !root.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|err| format!("chapter media: read root dir: {err}"))? {
        let entry = entry.map_err(|err| format!("chapter media: read root entry: {err}"))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.chars().all(|ch| ch.is_ascii_digit()) {
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(path)
                    .map_err(|err| format!("chapter media: remove legacy chapter dir: {err}"))?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn chapter_media_prune(
    app: AppHandle,
    chapter_id: i64,
    keep_cache_key: String,
    novel_id: Option<i64>,
    source_id: Option<String>,
    novel_name: Option<String>,
    novel_path: Option<String>,
    chapter_number: Option<String>,
    chapter_name: Option<String>,
    chapter_position: Option<i64>,
) -> Result<(), String> {
    let keep_cache_key = safe_segment(&keep_cache_key, "cache");
    for root in media_roots_for_lookup(&app)? {
        if let Some(chapter_dir) = content_chapter_dir_from_context(
            &root,
            novel_id,
            source_id.as_deref(),
            novel_path.as_deref(),
            novel_name.as_deref(),
            chapter_id,
            chapter_number.as_deref(),
            chapter_name.as_deref(),
            chapter_position,
        )? {
            prune_chapter_dir(&chapter_dir, &keep_cache_key)?;
        }
        for chapter_dir in content_chapter_dirs_for_lookup(&root, chapter_id)? {
            prune_chapter_dir(&chapter_dir, &keep_cache_key)?;
        }
        prune_chapter_dir(&chapter_dir_at(&root, chapter_id)?, &keep_cache_key)?;
    }
    Ok(())
}

#[tauri::command]
pub fn chapter_media_clear(
    app: AppHandle,
    chapter_id: i64,
    novel_id: Option<i64>,
    source_id: Option<String>,
    novel_name: Option<String>,
    novel_path: Option<String>,
    chapter_number: Option<String>,
    chapter_name: Option<String>,
    chapter_position: Option<i64>,
) -> Result<(), String> {
    for root in media_roots_for_lookup(&app)? {
        if let Some(chapter_dir) = content_chapter_dir_from_context(
            &root,
            novel_id,
            source_id.as_deref(),
            novel_path.as_deref(),
            novel_name.as_deref(),
            chapter_id,
            chapter_number.as_deref(),
            chapter_name.as_deref(),
            chapter_position,
        )? {
            clear_content_media_artifacts(&chapter_dir)?;
        }

        for chapter_dir in content_chapter_dirs_for_lookup(&root, chapter_id)? {
            clear_content_media_artifacts(&chapter_dir)?;
        }

        let dir = chapter_dir_at(&root, chapter_id)?;
        if dir.exists() {
            fs::remove_dir_all(dir)
                .map_err(|err| format!("chapter media: remove chapter dir: {err}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn chapter_media_clear_all(app: AppHandle) -> Result<(), String> {
    for root in media_roots_for_lookup(&app)? {
        if root.exists() {
            clear_storage_root(&root)?;
        }
    }
    Ok(())
}
