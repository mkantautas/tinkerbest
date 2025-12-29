#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::*;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            select_directory,
            detect_project,
            check_docker_daemon,
            get_running_containers,
            execute_code,
            execute_php,
            get_platform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
