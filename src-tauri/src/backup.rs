//! Backup file format v1: zip pack / unpack.
//!
//! The zip layout is:
//!
//! ```text
//! manifest.json           — JSON envelope (see src/lib/backup/format.ts)
//! chapters/<id>.html      — one entry per downloaded chapter body
//! ```
//!
//! The manifest is the source of truth for structure (novels,
//! categories, repositories, chapter rows, etc.). Chapter HTML lives
//! in separate entries so the JSON stays small and the archive is
//! human-inspectable. The TS wrappers `src/lib/backup/pack.ts` and
//! `unpack.ts` strip / re-merge `chapter.content` around these
//! commands.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const MANIFEST_ENTRY: &str = "manifest.json";
const CHAPTERS_PREFIX: &str = "chapters/";
const CHAPTER_SUFFIX: &str = ".html";

/// One downloaded chapter body, keyed by the local chapter row id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterContent {
    pub id: i64,
    pub html: String,
}

/// Result of `backup_unpack`: the raw manifest JSON plus every
/// chapter HTML entry the archive carried.
#[derive(Debug, Serialize)]
pub struct UnpackedBackup {
    pub manifest_json: String,
    pub chapters: Vec<ChapterContent>,
}

/// Write a backup zip to `output_path`.
///
/// `manifest_json` should be the output of TS-side
/// `encodeBackupManifest(...)` — this command does not validate or
/// reshape it; the JS side owns the schema.
#[tauri::command]
pub fn backup_pack(
    manifest_json: String,
    chapters: Vec<ChapterContent>,
    output_path: String,
) -> Result<(), String> {
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

    for chapter in &chapters {
        let entry_name = format!("{CHAPTERS_PREFIX}{}{CHAPTER_SUFFIX}", chapter.id);
        zip.start_file(&entry_name, options)
            .map_err(|err| format!("backup_pack: start {entry_name}: {err}"))?;
        zip.write_all(chapter.html.as_bytes())
            .map_err(|err| format!("backup_pack: write {entry_name}: {err}"))?;
    }

    zip.finish()
        .map_err(|err| format!("backup_pack: finalize: {err}"))?;
    Ok(())
}

/// Read a backup zip from `input_path` and return the manifest JSON
/// plus every `chapters/<id>.html` entry.
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

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("backup_unpack: read entry {index}: {err}"))?;
        let name = entry.name().to_string();

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
        }
    }

    let manifest_json = manifest_json
        .ok_or_else(|| "backup_unpack: archive is missing manifest.json".to_string())?;

    Ok(UnpackedBackup {
        manifest_json,
        chapters,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn pack_then_unpack_round_trips_manifest_and_chapters() {
        let dir = tempdir().expect("tempdir");
        let zip_path = dir.path().join("backup.zip");
        let zip_path_str = zip_path.to_string_lossy().to_string();

        let manifest_json = r#"{"version":1,"exportedAt":1700000000}"#.to_string();
        let chapters = vec![
            ChapterContent {
                id: 10,
                html: "<p>chapter ten</p>".into(),
            },
            ChapterContent {
                id: 11,
                html: "<p>chapter eleven</p>".into(),
            },
        ];

        backup_pack(manifest_json.clone(), chapters.clone(), zip_path_str.clone())
            .expect("pack");

        let unpacked = backup_unpack(zip_path_str).expect("unpack");
        assert_eq!(unpacked.manifest_json, manifest_json);
        assert_eq!(unpacked.chapters.len(), 2);

        let mut by_id = unpacked.chapters.clone();
        by_id.sort_by_key(|c| c.id);
        assert_eq!(by_id[0].id, 10);
        assert_eq!(by_id[0].html, "<p>chapter ten</p>");
        assert_eq!(by_id[1].id, 11);
        assert_eq!(by_id[1].html, "<p>chapter eleven</p>");
    }

    #[test]
    fn unpack_rejects_archive_without_manifest() {
        let dir = tempdir().expect("tempdir");
        let zip_path = dir.path().join("no-manifest.zip");

        // Build a zip with only a chapter entry, no manifest.json.
        let file = File::create(&zip_path).expect("create");
        let mut zip = ZipWriter::new(BufWriter::new(file));
        let options =
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
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
        let options =
            SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
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
