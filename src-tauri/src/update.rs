use std::{
    fs::{self, File},
    path::{Path, PathBuf},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

const UPDATE_DOWNLOAD_DIR: &str = "Norea Updates";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    build_channel: Option<&'static str>,
    build_time: Option<&'static str>,
    build_version: Option<&'static str>,
    git_sha: Option<&'static str>,
    github_run_attempt: Option<&'static str>,
    github_run_id: Option<&'static str>,
    platform: String,
    target_arch: &'static str,
    target_family: &'static str,
    target_os: &'static str,
}

#[tauri::command]
pub fn get_build_info() -> BuildInfo {
    BuildInfo {
        build_channel: empty_to_none(option_env!("NOREA_BUILD_CHANNEL")),
        build_time: empty_to_none(option_env!("NOREA_BUILD_TIME")),
        build_version: empty_to_none(option_env!("NOREA_BUILD_VERSION")),
        git_sha: empty_to_none(option_env!("NOREA_GIT_SHA")),
        github_run_attempt: empty_to_none(option_env!("NOREA_GITHUB_RUN_ATTEMPT")),
        github_run_id: empty_to_none(option_env!("NOREA_GITHUB_RUN_ID")),
        platform: current_platform(),
        target_arch: std::env::consts::ARCH,
        target_family: std::env::consts::FAMILY,
        target_os: std::env::consts::OS,
    }
}

#[tauri::command]
pub async fn download_and_open_update(
    app: AppHandle,
    url: String,
    file_name: String,
) -> Result<String, String> {
    if !is_allowed_update_url(&url) {
        return Err("unsupported update host".to_string());
    }

    let response = reqwest::Client::new()
        .get(&url)
        .header(reqwest::header::USER_AGENT, "Norea")
        .send()
        .await
        .map_err(|err| format!("download request failed: {err}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "download failed with HTTP {}",
            response.status().as_u16()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|err| format!("download read failed: {err}"))?;
    let updates_dir = app
        .path()
        .download_dir()
        .map_err(|err| format!("downloads directory unavailable: {err}"))?
        .join(UPDATE_DOWNLOAD_DIR);
    fs::create_dir_all(&updates_dir)
        .map_err(|err| format!("update directory unavailable: {err}"))?;

    let is_archive = is_zip_archive(&bytes);
    let archive_path = updates_dir.join(sanitize_file_name(&file_name));
    fs::write(&archive_path, &bytes).map_err(|err| format!("download save failed: {err}"))?;

    let installer_path = if is_archive {
        extract_installer_from_zip(&archive_path, &updates_dir)?
    } else {
        archive_path
    };

    mark_executable_if_needed(&installer_path)?;
    app.shell()
        .open(installer_path.to_string_lossy().to_string(), None)
        .map_err(|err| format!("installer open failed: {err}"))?;

    Ok(installer_path.to_string_lossy().to_string())
}

fn empty_to_none(value: Option<&'static str>) -> Option<&'static str> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn current_platform() -> String {
    let os = std::env::consts::OS;
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };

    if os == "android" {
        return match std::env::consts::ARCH {
            "aarch64" => "android-arm64".to_string(),
            "x86_64" => "android-x86_64".to_string(),
            other => format!("android-{other}"),
        };
    }

    format!("{os}-{arch}")
}

fn is_allowed_update_url(url: &str) -> bool {
    url.starts_with("https://github.com/tinywind/norea/")
        || url.starts_with("https://api.github.com/repos/tinywind/norea/")
}

fn sanitize_file_name(file_name: &str) -> String {
    let sanitized: String = file_name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            item if item.is_control() => '-',
            item => item,
        })
        .collect();
    let trimmed = sanitized.trim_matches(['.', ' ', '-']);

    if trimmed.is_empty() {
        "norea-update".to_string()
    } else {
        trimmed.to_string()
    }
}

fn is_zip_archive(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
}

fn extract_installer_from_zip(zip_path: &Path, updates_dir: &Path) -> Result<PathBuf, String> {
    let zip_file = File::open(zip_path).map_err(|err| format!("artifact open failed: {err}"))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|err| format!("artifact unzip failed: {err}"))?;

    let mut selected_index: Option<(usize, u8)> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|err| format!("artifact entry read failed: {err}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(priority) = installer_priority(entry.name()) else {
            continue;
        };
        if selected_index
            .map(|(_, selected_priority)| priority < selected_priority)
            .unwrap_or(true)
        {
            selected_index = Some((index, priority));
        }
    }

    let (index, _) = selected_index.ok_or_else(|| {
        "artifact did not contain a supported installer for this platform".to_string()
    })?;
    let mut entry = archive
        .by_index(index)
        .map_err(|err| format!("installer entry read failed: {err}"))?;
    let entry_name = Path::new(entry.name())
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "installer entry name is invalid".to_string())?;
    let target_path = updates_dir.join(sanitize_file_name(entry_name));
    let mut output =
        File::create(&target_path).map_err(|err| format!("installer create failed: {err}"))?;
    std::io::copy(&mut entry, &mut output)
        .map_err(|err| format!("installer extract failed: {err}"))?;

    Ok(target_path)
}

fn installer_priority(name: &str) -> Option<u8> {
    let lower_name = name.to_ascii_lowercase();

    match std::env::consts::OS {
        "windows" if lower_name.ends_with(".exe") => Some(0),
        "windows" if lower_name.ends_with(".msi") => Some(1),
        "linux" if lower_name.ends_with(".appimage") => Some(0),
        "linux" if lower_name.ends_with(".deb") => Some(1),
        "linux" if lower_name.ends_with(".rpm") => Some(2),
        "android" if lower_name.ends_with(".apk") => Some(0),
        _ => None,
    }
}

#[cfg(unix)]
fn mark_executable_if_needed(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let is_app_image = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("AppImage"));
    if !is_app_image {
        return Ok(());
    }

    let mut permissions =
        fs::metadata(path).map_err(|err| format!("installer metadata failed: {err}"))?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|err| format!("installer permission update failed: {err}"))
}

#[cfg(not(unix))]
fn mark_executable_if_needed(_path: &Path) -> Result<(), String> {
    Ok(())
}
