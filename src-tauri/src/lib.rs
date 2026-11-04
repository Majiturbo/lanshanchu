// 原生能力：
// - HTTP 插件让界面绕开浏览器跨域限制调用腾讯接口，可访问的域名见 capabilities/default.json；
// - opener 插件把 target="_blank" 的链接（来源原文、控制台）交给系统浏览器打开；
// - save_markdown 命令：弹出系统「另存为」对话框，把导出的 Markdown 写到用户选的位置。
//   路径只来自对话框，界面传不了任意路径，因此不开放文件系统插件。
// 开发版额外提供 debug_log 命令，把请求链路写到项目的 .debug/ 目录；发布版不编译这部分。

#[cfg(debug_assertions)]
mod debug_log {
    use std::{
        fs::{self, OpenOptions},
        io::Write,
        path::PathBuf,
    };

    fn dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(".debug")
    }

    /// 每次启动把上一次的日志保留为 network.prev.jsonl，当前日志从空文件开始
    pub fn rotate() {
        let d = dir();
        if let Err(e) = fs::create_dir_all(&d) {
            eprintln!("debug log: cannot create {}: {e}", d.display());
            return;
        }
        let current = d.join("network.jsonl");
        if current.exists() {
            if let Err(e) = fs::rename(&current, d.join("network.prev.jsonl")) {
                eprintln!("debug log: cannot rotate: {e}");
            }
        }
    }

    #[tauri::command]
    pub fn debug_log(line: String) -> Result<(), String> {
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir().join("network.jsonl"))
            .map_err(|e| e.to_string())?;
        // 前端传来的是单行 JSON；保险起见去掉换行，保证一行一条
        writeln!(f, "{}", line.replace(['\n', '\r'], " ")).map_err(|e| e.to_string())
    }
}

/// 导出 Markdown：用户在对话框里取消时返回 false。async 命令跑在后台线程，阻塞式对话框不会卡住主线程。
/// 仅桌面注册；移动端走前端系统分享。
#[cfg(not(mobile))]
#[tauri::command]
async fn save_markdown(app: tauri::AppHandle, name: String, content: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(path) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

/// iOS：开关 WKWebView 前进/后退手势。SPA 侧滑自管，必须保持关闭。
#[cfg(target_os = "ios")]
#[tauri::command]
fn ios_set_nav_gestures(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use tauri::Manager;
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    win.with_webview(move |platform| unsafe {
        let view: *mut AnyObject = platform.inner().cast();
        if !view.is_null() {
            let _: () = msg_send![&*view, setAllowsBackForwardNavigationGestures: enabled];
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "ios"))]
#[tauri::command]
fn ios_set_nav_gestures(_enabled: bool) -> Result<(), String> {
    Ok(())
}

fn set_ios_nav_gestures(app: &tauri::AppHandle, enabled: bool) {
    #[cfg(target_os = "ios")]
    {
        let _ = ios_set_nav_gestures(app.clone(), enabled);
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, enabled);
    }
}

/// Capacitor / 成熟 SPA 壳惯例：关掉 WK 外层 UIScrollView 滚动与橡胶带，
/// 键盘避让与列表滚动交给页内 overflow 容器，避免登录页整页上下晃。
#[cfg(target_os = "ios")]
fn configure_ios_spa_scroll(app: &tauri::AppHandle) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let _ = win.with_webview(|platform| unsafe {
        let view: *mut AnyObject = platform.inner().cast();
        if view.is_null() {
            return;
        }
        let _: () = msg_send![&*view, setAllowsBackForwardNavigationGestures: false];
        let scroll: *mut AnyObject = msg_send![&*view, scrollView];
        if scroll.is_null() {
            return;
        }
        let _: () = msg_send![&*scroll, setScrollEnabled: false];
        let _: () = msg_send![&*scroll, setBounces: false];
        let _: () = msg_send![&*scroll, setAlwaysBounceVertical: false];
        let _: () = msg_send![&*scroll, setAlwaysBounceHorizontal: false];
        // UIScrollViewContentInsetAdjustmentNever = 2
        let _: () = msg_send![&*scroll, setContentInsetAdjustmentBehavior: 2_i64];
    });
}

#[cfg(not(target_os = "ios"))]
fn configure_ios_spa_scroll(_app: &tauri::AppHandle) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init());

    // 系统「另存为」只在桌面；移动端导出走分享 / 下载，不挂 dialog 插件
    #[cfg(not(mobile))]
    let builder = builder.plugin(tauri_plugin_dialog::init());

    #[cfg(all(debug_assertions, not(mobile)))]
    let builder = {
        debug_log::rotate();
        builder.invoke_handler(tauri::generate_handler![save_markdown, debug_log::debug_log, ios_set_nav_gestures])
    };
    #[cfg(all(debug_assertions, mobile))]
    let builder = {
        debug_log::rotate();
        builder.invoke_handler(tauri::generate_handler![debug_log::debug_log, ios_set_nav_gestures])
    };
    #[cfg(all(not(debug_assertions), not(mobile)))]
    let builder = builder.invoke_handler(tauri::generate_handler![save_markdown, ios_set_nav_gestures]);
    #[cfg(all(not(debug_assertions), mobile))]
    let builder = builder.invoke_handler(tauri::generate_handler![ios_set_nav_gestures]);

    builder
        .setup(|app| {
            // iOS 27 Scene 下配置窗口有时尚未挂上；没有就显式建一个，避免只有原生壳、WebView 空白。
            #[cfg(mobile)]
            {
                use tauri::Manager;
                if app.webview_windows().is_empty() {
                    tauri::WebviewWindowBuilder::new(
                        app,
                        "main",
                        tauri::WebviewUrl::App("index.html".into()),
                    )
                    .title("阑珊处")
                    .build()?;
                }
            }
            // SPA：关掉 WK 前进后退手势 + 外层 scrollView 滚动/橡胶带（Capacitor 同款）。
            set_ios_nav_gestures(app.handle(), false);
            configure_ios_spa_scroll(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
