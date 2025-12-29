use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Model {
    pub name: String,
    pub namespace: String,
}

#[derive(Debug, Serialize)]
pub struct ProjectInfo {
    #[serde(rename = "isLaravel")]
    pub is_laravel: bool,
    #[serde(rename = "hasSail")]
    pub has_sail: bool,
    #[serde(rename = "hasDocker")]
    pub has_docker: bool,
    #[serde(rename = "sailRunning")]
    pub sail_running: bool,
    #[serde(rename = "dockerDaemonRunning")]
    pub docker_daemon_running: bool,
    #[serde(rename = "runningContainers")]
    pub running_containers: Vec<String>,
    #[serde(rename = "phpVersion")]
    pub php_version: Option<String>,
    #[serde(rename = "laravelVersion")]
    pub laravel_version: Option<String>,
    pub models: Vec<Model>,
}

#[derive(Debug, Serialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub output: String,
    pub error: String,
    #[serde(rename = "executionTime")]
    pub execution_time: u64,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

// Common Docker binary paths
const DOCKER_PATHS: &[&str] = &[
    "/usr/local/bin",
    "/usr/bin",
    "/opt/homebrew/bin",
    "/opt/local/bin",
    "/Applications/Docker.app/Contents/Resources/bin",
];

fn get_extended_path() -> String {
    let current_path = env::var("PATH").unwrap_or_default();
    let home = env::var("HOME").unwrap_or_default();
    let docker_home = format!("{}/.docker/bin", home);

    let mut paths: Vec<&str> = DOCKER_PATHS.to_vec();
    paths.push(&docker_home);

    let additional: Vec<&str> = paths
        .into_iter()
        .filter(|p| !current_path.contains(p))
        .collect();

    if additional.is_empty() {
        current_path
    } else {
        format!("{}:{}", additional.join(":"), current_path)
    }
}

fn find_docker_binary(binary: &str) -> String {
    let extended_path = get_extended_path();
    for path in extended_path.split(':') {
        let full_path = PathBuf::from(path).join(binary);
        if full_path.exists() {
            return full_path.to_string_lossy().to_string();
        }
    }
    binary.to_string()
}

#[tauri::command]
pub async fn select_directory(app: tauri::AppHandle) -> Option<String> {
    let result = app.dialog().file().blocking_pick_folder();

    result.map(|path| path.to_string())
}

#[tauri::command]
pub fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
pub async fn check_docker_daemon() -> bool {
    let docker = find_docker_binary("docker");
    let output = Command::new(&docker)
        .arg("info")
        .env("PATH", get_extended_path())
        .output();

    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn get_running_containers(project_path: String) -> Vec<String> {
    let docker = find_docker_binary("docker");
    let output = Command::new(&docker)
        .args(["compose", "ps", "--format", "json"])
        .current_dir(&project_path)
        .env("PATH", get_extended_path())
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut services: HashSet<String> = HashSet::new();

            for line in stdout.lines() {
                if line.starts_with('{') {
                    if let Ok(container) = serde_json::from_str::<serde_json::Value>(line) {
                        if container.get("State").and_then(|s| s.as_str()) == Some("running") {
                            if let Some(service) = container.get("Service").and_then(|s| s.as_str()) {
                                services.insert(service.to_string());
                            }
                        }
                    }
                }
            }

            if !services.is_empty() {
                return services.into_iter().collect();
            }
        }
    }

    // Fallback
    vec!["laravel.test".to_string()]
}

#[tauri::command]
pub async fn detect_project(project_path: String) -> ProjectInfo {
    let path = Path::new(&project_path);

    // Check for Laravel
    let artisan_path = path.join("artisan");
    let is_laravel = artisan_path.exists();

    // Scan models if Laravel
    let models = if is_laravel {
        scan_models(&project_path)
    } else {
        vec![]
    };

    // Check for Sail
    let sail_path = path.join("vendor/bin/sail");
    let has_sail = sail_path.exists();

    // Check for Docker
    let docker_compose_path = path.join("docker-compose.yml");
    let has_docker = docker_compose_path.exists();

    // Check Docker daemon
    let docker_daemon_running = check_docker_daemon().await;

    // Check if containers are running
    let (sail_running, running_containers) = if (has_sail || has_docker) && docker_daemon_running {
        let containers = get_running_containers(project_path.clone()).await;
        let running = !containers.is_empty() && containers[0] != "laravel.test" || containers.len() > 1;
        (running || check_docker_running(&project_path).await, containers)
    } else {
        (false, vec![])
    };

    // Get PHP version
    let php_version = get_php_version(&project_path, sail_running).await;

    // Get Laravel version
    let laravel_version = get_laravel_version(&project_path);

    ProjectInfo {
        is_laravel,
        has_sail,
        has_docker,
        sail_running,
        docker_daemon_running,
        running_containers,
        php_version,
        laravel_version,
        models,
    }
}

async fn check_docker_running(project_path: &str) -> bool {
    let docker = find_docker_binary("docker");
    let output = Command::new(&docker)
        .args(["compose", "ps", "--format", "json"])
        .current_dir(project_path)
        .env("PATH", get_extended_path())
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                if line.starts_with('{') {
                    if let Ok(container) = serde_json::from_str::<serde_json::Value>(line) {
                        if container.get("State").and_then(|s| s.as_str()) == Some("running") {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

async fn get_php_version(project_path: &str, sail_running: bool) -> Option<String> {
    let output = if sail_running {
        Command::new("./vendor/bin/sail")
            .args(["php", "-v"])
            .current_dir(project_path)
            .env("PATH", get_extended_path())
            .output()
    } else {
        Command::new("php")
            .arg("-v")
            .current_dir(project_path)
            .output()
    };

    if let Ok(out) = output {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // Extract version like "PHP 8.3.16"
            for line in stdout.lines() {
                if line.starts_with("PHP ") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        return Some(parts[1].to_string());
                    }
                }
            }
        }
    }
    None
}

fn get_laravel_version(project_path: &str) -> Option<String> {
    let composer_path = Path::new(project_path).join("composer.json");
    if composer_path.exists() {
        if let Ok(content) = fs::read_to_string(&composer_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(version) = json
                    .get("require")
                    .and_then(|r| r.get("laravel/framework"))
                    .and_then(|v| v.as_str())
                {
                    return Some(version.trim_start_matches('^').to_string());
                }
            }
        }
    }
    None
}

fn scan_models(project_path: &str) -> Vec<Model> {
    let models_dir = Path::new(project_path).join("app/Models");
    let mut models = Vec::new();

    if models_dir.exists() {
        scan_models_recursive(&models_dir, "App\\Models", &mut models);
    }

    models
}

fn scan_models_recursive(dir: &Path, namespace: &str, models: &mut Vec<Model>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().unwrap().to_string_lossy();
                let new_namespace = format!("{}\\{}", namespace, dir_name);
                scan_models_recursive(&path, &new_namespace, models);
            } else if path.extension().and_then(|e| e.to_str()) == Some("php") {
                let file_name = path.file_stem().unwrap().to_string_lossy().to_string();
                models.push(Model {
                    name: file_name.clone(),
                    namespace: format!("{}\\{}", namespace, file_name),
                });
            }
        }
    }
}

fn wrap_code_for_tinker(code: &str, models: &[Model]) -> String {
    // Remove PHP opening tags
    let mut code = code.to_string();
    code = code.trim_start_matches("<?php").trim_start().to_string();
    code = code.trim_start_matches("<?").trim_start().to_string();

    // Prepend use statements
    if !models.is_empty() {
        let use_statements: Vec<String> = models
            .iter()
            .map(|m| format!("use {};", m.namespace))
            .collect();
        code = format!("{} {}", use_statements.join(" "), code);
    }

    code
}

fn clean_tinker_output(output: &str) -> String {
    let mut cleaned = output.to_string();

    // Remove tinker prompts
    cleaned = cleaned.replace(">>> ", "");
    cleaned = cleaned.replace("... ", "");

    // Remove Psy Shell header lines
    let lines: Vec<&str> = cleaned
        .lines()
        .filter(|line| !line.contains("Psy Shell"))
        .collect();
    cleaned = lines.join("\n");

    // Remove trailing "=> null"
    if cleaned.trim().ends_with("=> null") {
        cleaned = cleaned.trim().trim_end_matches("=> null").to_string();
    }

    cleaned.trim().to_string()
}

#[tauri::command]
pub async fn execute_code(
    project_path: String,
    code: String,
    use_docker: bool,
    container: Option<String>,
    models: Vec<Model>,
) -> ExecutionResult {
    let start = Instant::now();
    let wrapped_code = wrap_code_for_tinker(&code, &models);
    let container_name = container.unwrap_or_else(|| "laravel.test".to_string());

    let output = if use_docker {
        let sail_path = Path::new(&project_path).join("vendor/bin/sail");
        if sail_path.exists() && container_name == "laravel.test" {
            Command::new("./vendor/bin/sail")
                .args(["artisan", "tinker", "--execute", &wrapped_code])
                .current_dir(&project_path)
                .env("PATH", get_extended_path())
                .env("TERM", "dumb")
                .output()
        } else {
            let docker = find_docker_binary("docker");
            Command::new(&docker)
                .args([
                    "compose", "exec", "-T", &container_name,
                    "php", "artisan", "tinker", "--execute", &wrapped_code,
                ])
                .current_dir(&project_path)
                .env("PATH", get_extended_path())
                .env("TERM", "dumb")
                .output()
        }
    } else {
        Command::new("php")
            .args(["artisan", "tinker", "--execute", &wrapped_code])
            .current_dir(&project_path)
            .env("TERM", "dumb")
            .output()
    };

    let execution_time = start.elapsed().as_millis() as u64;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let cleaned_output = clean_tinker_output(&stdout);

            ExecutionResult {
                success: out.status.success(),
                output: cleaned_output,
                error: stderr,
                execution_time,
                exit_code: out.status.code().unwrap_or(-1),
            }
        }
        Err(e) => ExecutionResult {
            success: false,
            output: String::new(),
            error: e.to_string(),
            execution_time,
            exit_code: -1,
        },
    }
}

#[tauri::command]
pub async fn execute_php(
    project_path: String,
    code: String,
    use_docker: bool,
    container: Option<String>,
) -> ExecutionResult {
    let start = Instant::now();
    let container_name = container.unwrap_or_else(|| "laravel.test".to_string());

    let output = if use_docker {
        let sail_path = Path::new(&project_path).join("vendor/bin/sail");
        if sail_path.exists() && container_name == "laravel.test" {
            Command::new("./vendor/bin/sail")
                .args(["php", "-r", &code])
                .current_dir(&project_path)
                .env("PATH", get_extended_path())
                .output()
        } else {
            let docker = find_docker_binary("docker");
            Command::new(&docker)
                .args([
                    "compose", "exec", "-T", &container_name,
                    "php", "-r", &code,
                ])
                .current_dir(&project_path)
                .env("PATH", get_extended_path())
                .output()
        }
    } else {
        Command::new("php")
            .args(["-r", &code])
            .current_dir(&project_path)
            .output()
    };

    let execution_time = start.elapsed().as_millis() as u64;

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();

            ExecutionResult {
                success: out.status.success(),
                output: stdout,
                error: stderr,
                execution_time,
                exit_code: out.status.code().unwrap_or(-1),
            }
        }
        Err(e) => ExecutionResult {
            success: false,
            output: String::new(),
            error: e.to_string(),
            execution_time,
            exit_code: -1,
        },
    }
}
