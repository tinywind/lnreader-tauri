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

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::chapter_media::chapter_media_src_from_backup_entry;

const MANIFEST_ENTRY: &str = "manifest.json";
const CHAPTERS_PREFIX: &str = "chapters/";
const CHAPTER_SUFFIX: &str = ".html";

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

/// One local chapter media reference discovered in downloaded HTML.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterMediaReference {
    pub media_src: String,
}

/// Result of `backup_unpack`: the raw manifest JSON plus legacy
/// chapter HTML and local media entries when an old archive carries them.
#[derive(Debug, Serialize)]
pub struct UnpackedBackup {
    pub manifest_json: String,
    pub chapters: Vec<ChapterContent>,
    pub chapter_media: Vec<ChapterMediaContent>,
}

fn write_backup_zip(manifest_json: String, output_path: String) -> Result<(), String> {
    let file = File::create(&output_path)
        .map_err(|err| format!("backup_pack: failed to create '{output_path}': {err}"))?;
    let mut zip = ZipWriter::new(BufWriter::new(file));
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    zip.start_file(MANIFEST_ENTRY, options)
        .map_err(|err| format!("backup_pack: start manifest: {err}"))?;
    zip.write_all(manifest_json.as_bytes())
        .map_err(|err| format!("backup_pack: write manifest: {err}"))?;
    zip.finish()
        .map_err(|err| format!("backup_pack: finalize: {err}"))?;
    Ok(())
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
    _chapters: Vec<ChapterContent>,
    _chapter_media: Vec<ChapterMediaReference>,
    output_path: String,
) -> Result<(), String> {
    write_backup_zip(manifest_json, output_path)
}

/// Read a backup zip from `input_path` and return the manifest JSON
/// plus every `chapters/<id>.html` and chapter media entry.
///
/// Unrelated entries (foreign tools writing extra files) are skipped
/// silently. Missing `manifest.json` is an error.
#[tauri::command]
pub fn backup_unpack(input_path: String) -> Result<UnpackedBackup, String> {
    let file = File::open(&input_path)
        .map_err(|err| format!("backup_unpack: failed to open '{input_path}': {err}"))?;
    let mut archive = ZipArchive::new(BufReader::new(file))
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
