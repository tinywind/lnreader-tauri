mod backup;
mod scraper;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description:
                "create initial schema (novel, chapter, category, novel_category, repository)",
            sql: include_str!("../../drizzle/0000_slow_mach_iv.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "chapter: add content column (downloaded HTML body)",
            sql: include_str!("../../drizzle/0001_fuzzy_adam_warlock.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "installed_plugin + repository_index_cache tables",
            sql: include_str!("../../drizzle/0002_plugin_persistence.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "track library registration and chapter discovery timestamps",
            sql: include_str!("../../drizzle/0003_update_discovery_timestamps.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "enforce single plugin repository",
            sql: include_str!("../../drizzle/0004_single_repository.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:lnreader.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            backup::backup_pack,
            backup::backup_unpack,
            scraper::webview_fetch,
            scraper::webview_extract,
            scraper::scraper_navigate,
            scraper::scraper_set_bounds,
            scraper::scraper_hide,
            scraper::scraper_clear_cookies,
            scraper::scraper_open_devtools,
        ])
        .setup(|app| {
            app.manage(scraper::ScraperState::default());
            scraper::init_scraper(app.handle())
                .map_err(|err| format!("scraper init: {err}"))?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
