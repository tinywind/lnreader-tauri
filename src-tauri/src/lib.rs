mod backup;
mod cf_webview;

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
            cf_webview::cf_solve,
            backup::backup_pack,
            backup::backup_unpack,
        ])
        .setup(|app| {
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
