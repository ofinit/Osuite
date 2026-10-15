// Desktop shell: starts the bundled OSuite server (sidecar), shows a splash
// until it reports ready, then points the window at it. On exit it asks the
// server to shut down cleanly so the embedded PostgreSQL stops gracefully.

use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 47800;
const PG_PORT: u16 = 54329;

/// The preferred port if nothing else holds it, otherwise any free one, so
/// another program (or a second PostgreSQL) on the default cannot stop OSuite.
fn pick_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(preferred)
}
const SHUTDOWN_GRACE: Duration = Duration::from_secs(15);

struct Sidecar {
    child: Mutex<Option<CommandChild>>,
    exited: Arc<AtomicBool>,
    token: String,
    port: u16,
}

fn random_token() -> String {
    let mut buf = [0u8; 24];
    getrandom::fill(&mut buf).expect("OS random source unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// Tauri hands out Windows "verbatim" paths (`\\?\D:\...`), which PostgreSQL's
/// tools cannot use; give the server the ordinary form.
fn plain_path(p: &std::path::Path) -> String {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

fn show_error(app: &AppHandle, message: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let escaped = message.replace('\\', "\\\\").replace('`', "\\`");
        let _ = w.eval(&format!("window.showError(`{escaped}`)"));
    }
}

fn start_server(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let resources = app.path().resource_dir()?.join("resources");
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let token = random_token();
    let port = pick_port(PORT);
    let pg_port = pick_port(PG_PORT);
    let path = |p: std::path::PathBuf| plain_path(&p);
    // Everything the server prints goes to server.log next to the data, for support.
    let mut log = std::fs::File::create(data_dir.join("server.log")).ok();

    let (mut rx, child) = app
        .shell()
        .sidecar("osuite-server")?
        // The shell plugin starts sidecars with an empty environment; PostgreSQL's
        // tools need the system's (SystemRoot, COMSPEC, TEMP), so pass it through.
        .envs(std::env::vars())
        .envs([
            ("NODE_ENV".to_string(), "production".to_string()),
            ("OSUITE_PORT".to_string(), port.to_string()),
            ("OSUITE_PG_PORT".to_string(), pg_port.to_string()),
            ("OSUITE_DATA_DIR".to_string(), path(data_dir)),
            ("OSUITE_PG_BIN".to_string(), path(resources.join("pgsql").join("bin"))),
            ("OSUITE_MIGRATIONS".to_string(), path(resources.join("migrations"))),
            ("OSUITE_WEB_DIST".to_string(), path(resources.join("web"))),
            ("OSUITE_SHUTDOWN_TOKEN".to_string(), token.clone()),
        ])
        .spawn()?;

    let exited = Arc::new(AtomicBool::new(false));
    app.manage(Sidecar { child: Mutex::new(Some(child)), exited: exited.clone(), token, port });

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut ready = false;
        let mut stderr_tail = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    if let Some(f) = log.as_mut() {
                        let _ = f.write_all(&bytes);
                    }
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(url) = line.trim().strip_prefix("OSUITE_READY ") {
                        ready = true;
                        if let (Some(w), Ok(url)) = (handle.get_webview_window("main"), url.parse::<tauri::Url>()) {
                            let _ = w.navigate(url);
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    if let Some(f) = log.as_mut() {
                        let _ = f.write_all(&bytes);
                    }
                    stderr_tail.push_str(&String::from_utf8_lossy(&bytes));
                    if stderr_tail.len() > 4000 {
                        stderr_tail = stderr_tail.split_off(stderr_tail.len() - 4000);
                    }
                }
                CommandEvent::Terminated(status) => {
                    if let Some(f) = log.as_mut() {
                        let _ = writeln!(f, "[server exited: {:?}]", status.code);
                    }
                    exited.store(true, Ordering::SeqCst);
                    if !ready {
                        let reason = format!("Exit code {:?}\n{}", status.code, stderr_tail.trim());
                        show_error(&handle, &reason);
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// Asks the server to stop (it then stops PostgreSQL), waiting a bounded time
/// before falling back to killing the process.
fn stop_server(app: &AppHandle) {
    let Some(state) = app.try_state::<Sidecar>() else { return };
    if state.exited.load(Ordering::SeqCst) {
        return;
    }
    let request = format!(
        "POST /api/system/shutdown HTTP/1.1\r\nHost: 127.0.0.1\r\nx-shutdown-token: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        state.token
    );
    if let Ok(mut stream) = TcpStream::connect_timeout(&([127, 0, 0, 1], state.port).into(), Duration::from_secs(2)) {
        let _ = stream.write_all(request.as_bytes());
    }
    let deadline = Instant::now() + SHUTDOWN_GRACE;
    while Instant::now() < deadline && !state.exited.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(100));
    }
    if !state.exited.load(Ordering::SeqCst) {
        if let Some(child) = state.child.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Err(err) = start_server(app.handle()) {
                show_error(app.handle(), &err.to_string());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build OSuite desktop shell")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_server(app);
            }
        });
}
