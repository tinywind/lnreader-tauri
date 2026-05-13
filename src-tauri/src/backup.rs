//! Backup file format v1: zip pack / unpack.
//!
//! The current zip layout is:
//!
//! ```text
//! manifest.json           — JSON envelope (see src/lib/backup/format.ts)
//! ```
//!
//! The manifest is the source of truth for structure (novels,
//! categories, repository, chapter rows, etc.). Downloaded chapter
//! bodies and media stay in the configured storage folder so backup
//! archives stay small. `backup_unpack` still accepts the old
//! `chapters/<id>.html` and `chapter-media/...` entries for backups
//! produced before that content was externalized.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sqlx::Sqlite;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_sql::{DbInstances, DbPool};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::chapter_media::chapter_media_src_from_backup_entry;

const MANIFEST_ENTRY: &str = "manifest.json";
const CHAPTERS_PREFIX: &str = "chapters/";
const CHAPTER_SUFFIX: &str = ".html";
const DB_URL: &str = "sqlite:norea.db";
const BACKUP_TEMP_DIR: &str = "backup";

/// One downloaded chapter body, keyed by the local chapter row id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterContent {
    pub id: i64,
    pub html: String,
}

/// One local chapter media file to include in the backup archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterMediaContent {
    pub media_src: String,
    pub body: Vec<u8>,
}

/// Result of `backup_unpack`: the raw manifest JSON plus legacy
/// chapter HTML and local media entries when an old archive carries them.
#[derive(Debug, Serialize)]
pub struct UnpackedBackup {
    pub manifest_json: String,
    pub chapters: Vec<ChapterContent>,
    pub chapter_media: Vec<ChapterMediaContent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRestoreManifest {
    novels: Vec<BackupRestoreNovel>,
    chapters: Vec<BackupRestoreChapter>,
    categories: Vec<BackupRestoreCategory>,
    novel_categories: Vec<BackupRestoreNovelCategory>,
    repositories: Vec<BackupRestoreRepository>,
    installed_plugins: Option<Vec<BackupRestoreInstalledPlugin>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRestoreNovel {
    id: i64,
    plugin_id: String,
    path: String,
    name: String,
    cover: Option<String>,
    summary: Option<String>,
    author: Option<String>,
    artist: Option<String>,
    status: Option<String>,
    genres: Option<String>,
    in_library: bool,
    is_local: bool,
    created_at: i64,
    updated_at: i64,
    library_added_at: Option<i64>,
    last_read_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRestoreChapter {
    id: i64,
    novel_id: i64,
    path: String,
    name: String,
    chapter_number: Option<String>,
    position: i64,
    page: String,
    bookmark: bool,
    unread: bool,
    progress: i64,
    is_downloaded: bool,
    content_type: Option<String>,
    content: Option<String>,
    media_bytes: Option<i64>,
    release_time: Option<String>,
    read_at: Option<i64>,
    created_at: i64,
    found_at: i64,
    updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRestoreCategory {
    id: i64,
    name: String,
    sort: i64,
    is_system: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRestoreNovelCategory {
    id: i64,
    novel_id: i64,
    category_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRestoreRepository {
    id: i64,
    url: String,
    name: Option<String>,
    added_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRestoreInstalledPlugin {
    id: String,
    name: String,
    lang: String,
    version: String,
    icon_url: String,
    source_url: String,
    source_code: String,
    installed_at: i64,
}

fn bool_to_int(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn backup_content_type(value: Option<&str>) -> &str {
    match value {
        Some("pdf") => "pdf",
        Some("text") => "text",
        _ => "html",
    }
}

fn content_byte_len(value: Option<&str>) -> i64 {
    value.map(|content| content.as_bytes().len() as i64).unwrap_or(0)
}

fn select_backup_repository(
    repositories: &[BackupRestoreRepository],
) -> Option<&BackupRestoreRepository> {
    repositories
        .iter()
        .max_by(|left, right| left.added_at.cmp(&right.added_at).then(left.id.cmp(&right.id)))
}

async fn execute_restore_snapshot(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    manifest: BackupRestoreManifest,
    media_bytes_by_chapter_id: HashMap<i64, i64>,
) -> Result<(), String> {
    sqlx::query("DELETE FROM novel_category")
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: delete novel_category: {err}"))?;
    sqlx::query("DELETE FROM chapter")
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: delete chapter: {err}"))?;
    sqlx::query("DELETE FROM novel_stats")
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: delete novel_stats: {err}"))?;
    sqlx::query("DELETE FROM novel")
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: delete novel: {err}"))?;
    sqlx::query("DELETE FROM category")
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: delete category: {err}"))?;
    sqlx::query("DELETE FROM repository")
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: delete repository: {err}"))?;
    sqlx::query("DELETE FROM repository_index_cache")
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: delete repository_index_cache: {err}"))?;
    if manifest.installed_plugins.is_some() {
        sqlx::query("DELETE FROM installed_plugin")
            .execute(&mut **tx)
            .await
            .map_err(|err| format!("backup_restore_snapshot: delete installed_plugin: {err}"))?;
    }

    for category in &manifest.categories {
        sqlx::query("INSERT INTO category (id, name, sort, is_system) VALUES ($1, $2, $3, $4)")
            .bind(category.id)
            .bind(&category.name)
            .bind(category.sort)
            .bind(bool_to_int(category.is_system))
            .execute(&mut **tx)
            .await
            .map_err(|err| format!("backup_restore_snapshot: insert category: {err}"))?;
    }

    if let Some(repository) = select_backup_repository(&manifest.repositories) {
        sqlx::query("INSERT INTO repository (id, url, name, added_at) VALUES ($1, $2, $3, $4)")
            .bind(1_i64)
            .bind(repository.url.as_str())
            .bind(repository.name.as_deref())
            .bind(repository.added_at)
            .execute(&mut **tx)
            .await
            .map_err(|err| format!("backup_restore_snapshot: insert repository: {err}"))?;
    }

    if let Some(installed_plugins) = &manifest.installed_plugins {
        for plugin in installed_plugins {
            sqlx::query(
                "INSERT INTO installed_plugin (
                    id, name, lang, version, icon_url, source_url, source_code, installed_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(plugin.id.as_str())
            .bind(plugin.name.as_str())
            .bind(plugin.lang.as_str())
            .bind(plugin.version.as_str())
            .bind(plugin.icon_url.as_str())
            .bind(plugin.source_url.as_str())
            .bind(plugin.source_code.as_str())
            .bind(plugin.installed_at)
            .execute(&mut **tx)
            .await
            .map_err(|err| format!("backup_restore_snapshot: insert installed_plugin: {err}"))?;
        }
    }

    for novel in &manifest.novels {
        sqlx::query(
            "INSERT INTO novel (
                id, plugin_id, path, name, cover, summary, author, artist,
                status, genres, in_library, is_local,
                created_at, updated_at, library_added_at, last_read_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
        )
        .bind(novel.id)
        .bind(novel.plugin_id.as_str())
        .bind(novel.path.as_str())
        .bind(novel.name.as_str())
        .bind(novel.cover.as_deref())
        .bind(novel.summary.as_deref())
        .bind(novel.author.as_deref())
        .bind(novel.artist.as_deref())
        .bind(novel.status.as_deref())
        .bind(novel.genres.as_deref())
        .bind(bool_to_int(novel.in_library))
        .bind(bool_to_int(novel.is_local))
        .bind(novel.created_at)
        .bind(novel.updated_at)
        .bind(novel.library_added_at)
        .bind(novel.last_read_at)
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: insert novel: {err}"))?;
    }

    for chapter in &manifest.chapters {
        let restored_downloaded = chapter.is_downloaded && chapter.content.is_some();
        let restored_media_bytes = if restored_downloaded {
            media_bytes_by_chapter_id
                .get(&chapter.id)
                .copied()
                .or(chapter.media_bytes)
                .unwrap_or(0)
        } else {
            0
        };
        sqlx::query(
            "INSERT INTO chapter (
                id, novel_id, path, name, chapter_number, position, page,
                bookmark, unread, progress, is_downloaded, content, content_bytes,
                media_bytes, content_type, release_time, read_at, created_at, found_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)",
        )
        .bind(chapter.id)
        .bind(chapter.novel_id)
        .bind(chapter.path.as_str())
        .bind(chapter.name.as_str())
        .bind(chapter.chapter_number.as_deref())
        .bind(chapter.position)
        .bind(chapter.page.as_str())
        .bind(bool_to_int(chapter.bookmark))
        .bind(bool_to_int(chapter.unread))
        .bind(chapter.progress)
        .bind(bool_to_int(restored_downloaded))
        .bind(chapter.content.as_deref())
        .bind(content_byte_len(chapter.content.as_deref()))
        .bind(restored_media_bytes)
        .bind(backup_content_type(chapter.content_type.as_deref()))
        .bind(chapter.release_time.as_deref())
        .bind(chapter.read_at)
        .bind(chapter.created_at)
        .bind(chapter.found_at)
        .bind(chapter.updated_at)
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: insert chapter: {err}"))?;
    }

    for link in &manifest.novel_categories {
        sqlx::query(
            "INSERT INTO novel_category (id, novel_id, category_id) VALUES ($1, $2, $3)",
        )
        .bind(link.id)
        .bind(link.novel_id)
        .bind(link.category_id)
        .execute(&mut **tx)
        .await
        .map_err(|err| format!("backup_restore_snapshot: insert novel_category: {err}"))?;
    }

    Ok(())
}

fn write_manifest_entry<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    manifest_json: &str,
    error_prefix: &str,
) -> Result<(), String> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    zip.start_file(MANIFEST_ENTRY, options)
        .map_err(|err| format!("{error_prefix}: start manifest: {err}"))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|err| format!("{error_prefix}: write manifest: {err}"))?;
    Ok(())
}

fn write_backup_zip(manifest_json: String, output_path: String) -> Result<(), String> {
    let file = File::create(&output_path)
        .map_err(|err| format!("backup_pack: failed to create '{output_path}': {err}"))?;
    let mut zip = ZipWriter::new(BufWriter::new(file));
    write_manifest_entry(&mut zip, &manifest_json, "backup_pack")?;
    zip.finish()
        .map_err(|err| format!("backup_pack: finalize: {err}"))?;
    Ok(())
}

fn write_backup_zip_file<W: Write + Seek>(
    file: W,
    manifest_json: String,
    error_prefix: &str,
) -> Result<(), String> {
    let mut zip = ZipWriter::new(BufWriter::new(file));
    write_manifest_entry(&mut zip, &manifest_json, error_prefix)?;
    zip.finish()
        .map_err(|err| format!("{error_prefix}: finalize: {err}"))?;
    Ok(())
}

fn backup_temp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|err| format!("backup_pack_temp_file: app cache dir: {err}"))?
        .join(BACKUP_TEMP_DIR);
    fs::create_dir_all(&dir)
        .map_err(|err| format!("backup_pack_temp_file: create temp dir: {err}"))?;
    Ok(dir)
}

fn backup_temp_path(dir: &Path, attempt: u32) -> PathBuf {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    dir.join(format!("norea-backup-{now}-{attempt}.zip"))
}

fn write_backup_temp_file(app: AppHandle, manifest_json: String) -> Result<String, String> {
    let dir = backup_temp_dir(&app)?;
    for attempt in 0..16 {
        let path = backup_temp_path(&dir, attempt);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                if let Err(err) =
                    write_backup_zip_file(file, manifest_json, "backup_pack_temp_file")
                {
                    let _ = fs::remove_file(&path);
                    return Err(err);
                }
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(format!("backup_pack_temp_file: create temp file: {err}"));
            }
        }
    }
    Err("backup_pack_temp_file: failed to allocate a temp file".to_string())
}

fn backup_zip_bytes(manifest_json: String) -> Result<Vec<u8>, String> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    write_manifest_entry(&mut zip, &manifest_json, "backup_pack_bytes")?;
    let cursor = zip
        .finish()
        .map_err(|err| format!("backup_pack_bytes: finalize: {err}"))?;
    Ok(cursor.into_inner())
}

/// Write a backup zip to `output_path`.
///
/// `manifest_json` should be the output of TS-side
/// `encodeBackupManifest(...)` — this command does not validate or
/// reshape it; the JS side owns the schema.
#[tauri::command]
pub fn backup_pack(
    _app: AppHandle,
    manifest_json: String,
    output_path: String,
) -> Result<(), String> {
    write_backup_zip(manifest_json, output_path)
}

#[tauri::command]
pub fn backup_pack_temp_file(app: AppHandle, manifest_json: String) -> Result<String, String> {
    write_backup_temp_file(app, manifest_json)
}

#[tauri::command]
pub fn backup_delete_temp_file(app: AppHandle, path: String) -> Result<(), String> {
    let temp_dir = backup_temp_dir(&app)?;
    let temp_dir = temp_dir
        .canonicalize()
        .map_err(|err| format!("backup_delete_temp_file: temp dir: {err}"))?;
    let path = PathBuf::from(path);
    let file_path = path
        .canonicalize()
        .map_err(|err| format!("backup_delete_temp_file: temp file: {err}"))?;
    if !file_path.starts_with(&temp_dir) {
        return Err("backup_delete_temp_file: path is outside backup temp dir".to_string());
    }
    fs::remove_file(&file_path).map_err(|err| format!("backup_delete_temp_file: remove: {err}"))
}

#[tauri::command]
pub fn backup_pack_bytes(_app: AppHandle, manifest_json: String) -> Result<Vec<u8>, String> {
    backup_zip_bytes(manifest_json)
}

#[tauri::command]
pub async fn backup_restore_snapshot(
    db_instances: State<'_, DbInstances>,
    manifest_json: String,
    media_bytes_by_chapter_id: HashMap<i64, i64>,
) -> Result<(), String> {
    let manifest: BackupRestoreManifest = serde_json::from_str(&manifest_json)
        .map_err(|err| format!("backup_restore_snapshot: parse manifest: {err}"))?;
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            None => return Err("backup_restore_snapshot: norea.db is not loaded".to_string()),
        }
    };
    let mut tx = pool
        .begin()
        .await
        .map_err(|err| format!("backup_restore_snapshot: begin transaction: {err}"))?;

    if let Err(error) = execute_restore_snapshot(&mut tx, manifest, media_bytes_by_chapter_id).await
    {
        let _ = tx.rollback().await;
        return Err(error);
    }

    tx.commit()
        .await
        .map_err(|err| format!("backup_restore_snapshot: commit transaction: {err}"))?;
    Ok(())
}

/// Read a backup zip from `input_path` and return the manifest JSON
/// plus every `chapters/<id>.html` and chapter media entry.
///
/// Unrelated entries (foreign tools writing extra files) are skipped
/// silently. Missing `manifest.json` is an error.
fn read_backup_archive<R: Read + Seek>(reader: R) -> Result<UnpackedBackup, String> {
    let mut archive = ZipArchive::new(reader)
        .map_err(|err| format!("backup_unpack: not a valid zip: {err}"))?;

    let mut manifest_json: Option<String> = None;
    let mut chapters: Vec<ChapterContent> = Vec::new();
    let mut chapter_media: Vec<ChapterMediaContent> = Vec::new();

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("backup_unpack: read entry {index}: {err}"))?;
        let name = entry.name().to_string();
        if entry.is_dir() {
            continue;
        }

        if name == MANIFEST_ENTRY {
            let mut buf = String::new();
            entry
                .read_to_string(&mut buf)
                .map_err(|err| format!("backup_unpack: read manifest: {err}"))?;
            manifest_json = Some(buf);
            continue;
        }

        if let Some(rest) = name.strip_prefix(CHAPTERS_PREFIX) {
            if let Some(stem) = rest.strip_suffix(CHAPTER_SUFFIX) {
                let Ok(id) = stem.parse::<i64>() else {
                    continue;
                };
                let mut html = String::new();
                entry
                    .read_to_string(&mut html)
                    .map_err(|err| format!("backup_unpack: read {name}: {err}"))?;
                chapters.push(ChapterContent { id, html });
            }
            continue;
        }

        if let Some(media_src) = chapter_media_src_from_backup_entry(&name) {
            let mut body = Vec::new();
            entry
                .read_to_end(&mut body)
                .map_err(|err| format!("backup_unpack: read {name}: {err}"))?;
            chapter_media.push(ChapterMediaContent { media_src, body });
        }
    }

    let manifest_json = manifest_json
        .ok_or_else(|| "backup_unpack: archive is missing manifest.json".to_string())?;

    Ok(UnpackedBackup {
        manifest_json,
        chapters,
        chapter_media,
    })
}

#[tauri::command]
pub fn backup_unpack(input_path: String) -> Result<UnpackedBackup, String> {
    let file = File::open(&input_path)
        .map_err(|err| format!("backup_unpack: failed to open '{input_path}': {err}"))?;
    read_backup_archive(BufReader::new(file))
}

#[tauri::command]
pub fn backup_unpack_bytes(body: Vec<u8>) -> Result<UnpackedBackup, String> {
    read_backup_archive(Cursor::new(body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn pack_then_unpack_round_trips_manifest_only() {
        let dir = tempdir().expect("tempdir");
        let zip_path = dir.path().join("backup.zip");
        let zip_path_str = zip_path.to_string_lossy().to_string();

        let manifest_json = r#"{"version":1,"exportedAt":1700000000}"#.to_string();

        write_backup_zip(manifest_json.clone(), zip_path_str.clone()).expect("pack");

        let unpacked = backup_unpack(zip_path_str).expect("unpack");
        assert_eq!(unpacked.manifest_json, manifest_json);
        assert!(unpacked.chapters.is_empty());
        assert!(unpacked.chapter_media.is_empty());
    }

    #[test]
    fn unpack_accepts_legacy_chapter_media() {
        let dir = tempdir().expect("tempdir");
        let zip_path = dir.path().join("backup.zip");
        let zip_path_str = zip_path.to_string_lossy().to_string();

        let file = File::create(&zip_path).expect("create");
        let mut zip = ZipWriter::new(BufWriter::new(file));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file(MANIFEST_ENTRY, options).expect("manifest");
        zip.write_all(br#"{"version":1,"exportedAt":1700000000}"#)
            .expect("manifest body");
        zip.start_file("chapter-media/10/cache/image.png", options)
            .expect("media");
        zip.write_all(&[1, 2, 3, 4]).expect("media body");
        zip.finish().expect("finish");

        let unpacked = backup_unpack(zip_path_str).expect("unpack");
        assert_eq!(unpacked.chapter_media.len(), 1);
        assert_eq!(
            unpacked.chapter_media[0].media_src.as_str(),
            "norea-media://chapter/10/cache/image.png"
        );
        assert_eq!(unpacked.chapter_media[0].body.as_slice(), &[1, 2, 3, 4]);
    }

    #[test]
    fn unpack_rejects_archive_without_manifest() {
        let dir = tempdir().expect("tempdir");
        let zip_path = dir.path().join("no-manifest.zip");

        // Build a zip with only a chapter entry, no manifest.json.
        let file = File::create(&zip_path).expect("create");
        let mut zip = ZipWriter::new(BufWriter::new(file));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("chapters/1.html", options).expect("start");
        zip.write_all(b"<p>orphan</p>").expect("write");
        zip.finish().expect("finish");

        let result = backup_unpack(zip_path.to_string_lossy().to_string());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("manifest.json"), "error was: {err}");
    }

    #[test]
    fn unpack_skips_unknown_entries() {
        let dir = tempdir().expect("tempdir");
        let zip_path = dir.path().join("with-junk.zip");

        let file = File::create(&zip_path).expect("create");
        let mut zip = ZipWriter::new(BufWriter::new(file));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file(MANIFEST_ENTRY, options).expect("manifest");
        zip.write_all(br#"{"version":1,"exportedAt":0}"#)
            .expect("manifest body");
        zip.start_file("README.txt", options).expect("readme");
        zip.write_all(b"ignore me").expect("readme body");
        zip.start_file("chapters/not-a-number.html", options)
            .expect("bad name");
        zip.write_all(b"ignored").expect("bad body");
        zip.start_file("chapters/42.html", options).expect("good");
        zip.write_all(b"<p>kept</p>").expect("good body");
        zip.finish().expect("finish");

        let unpacked = backup_unpack(zip_path.to_string_lossy().to_string()).expect("unpack");
        assert_eq!(unpacked.chapters.len(), 1);
        assert_eq!(unpacked.chapters[0].id, 42);
        assert_eq!(unpacked.chapters[0].html, "<p>kept</p>");
    }
}
