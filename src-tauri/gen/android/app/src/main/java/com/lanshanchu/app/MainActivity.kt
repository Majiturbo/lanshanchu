package com.lanshanchu.app

import android.content.Intent
import android.content.pm.ActivityInfo
import android.database.ContentObserver
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  private var hooked = false
  private var orientMode = "portrait"
  private val rotationObserver = object : ContentObserver(Handler(Looper.getMainLooper())) {
    override fun onChange(selfChange: Boolean) {
      applyOrientation(orientMode)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    contentResolver.registerContentObserver(
      Settings.System.getUriFor(Settings.System.ACCELEROMETER_ROTATION),
      false,
      rotationObserver,
    )
    // 默认深色底用浅色系统图标。应用内切到浅色后，由页面调用 LanshanBars。
    applySystemBarIcons(darkPage = true)
    window.decorView.post { hookWebView(retries = 12) }
  }

  override fun onDestroy() {
    contentResolver.unregisterContentObserver(rotationObserver)
    super.onDestroy()
  }

  override fun onResume() {
    super.onResume()
    hookWebView(retries = 6)
  }

  private fun applySystemBarIcons(darkPage: Boolean) {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    // true 表示深色图标，用在浅色页面上。
    controller.isAppearanceLightStatusBars = !darkPage
    controller.isAppearanceLightNavigationBars = !darkPage
  }

  private fun hookWebView(retries: Int) {
    val root = window.decorView as? ViewGroup ?: return
    val web = findWebView(root)
    if (web == null) {
      if (retries > 0) root.postDelayed({ hookWebView(retries - 1) }, 120)
      return
    }
    // 关掉系统 WebView 整页缩放；地图捏合由前端 stage 手势处理
    web.settings.setSupportZoom(false)
    web.settings.builtInZoomControls = false
    web.settings.displayZoomControls = false
    if (!hooked) {
      web.addJavascriptInterface(BarBridge(), "LanshanBars")
      web.addJavascriptInterface(ShareBridge(), "LanshanShare")
      web.addJavascriptInterface(AppBridge(), "LanshanApp")
      hooked = true
    }
    // 根页返回桌面：JS 派 lanshan:move-to-back 时原生兜底（桥偶发未挂上）
    web.evaluateJavascript(
      """
      (function(){
        if (window.__lanshanBackHooked) return;
        window.__lanshanBackHooked = true;
        document.addEventListener('lanshan:move-to-back', function(){
          try { LanshanApp.moveToBack(); } catch (e) {}
        });
      })();
      """.trimIndent(),
      null,
    )
    web.evaluateJavascript("document.dispatchEvent(new Event('lanshan:orient-ready'))", null)
    web.evaluateJavascript(
      "(function(){var t=document.documentElement.dataset.theme;if(t==='light')return 'light';if(t==='dark')return 'dark';return matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';})()",
    ) { raw ->
      applySystemBarIcons(darkPage = raw?.contains("light") != true)
    }
  }

  private fun findWebView(group: ViewGroup): WebView? {
    for (i in 0 until group.childCount) {
      val child = group.getChildAt(i)
      if (child is WebView) return child
      if (child is ViewGroup) {
        findWebView(child)?.let { return it }
      }
    }
    return null
  }

  private inner class BarBridge {
    @JavascriptInterface
    fun setDark(dark: Boolean) {
      runOnUiThread { applySystemBarIcons(darkPage = dark) }
    }
  }

  private inner class ShareBridge {
    @JavascriptInterface
    fun shareText(title: String, text: String) {
      runOnUiThread {
        val send = Intent(Intent.ACTION_SEND).apply {
          type = "text/plain"
          putExtra(Intent.EXTRA_SUBJECT, title)
          putExtra(Intent.EXTRA_TEXT, text)
        }
        startActivity(Intent.createChooser(send, title))
      }
    }
  }

  /** 首页再按返回：回到桌面后台，不 exit 杀进程（否则像闪退） */
  private inner class AppBridge {
    @JavascriptInterface
    fun moveToBack() {
      runOnUiThread { moveTaskToBack(true) }
    }

    /** 系统方向锁开着时为 true。读设置不需要写权限。 */
    @JavascriptInterface
    fun rotationLocked(): Boolean {
      return Settings.System.getInt(contentResolver, Settings.System.ACCELEROMETER_ROTATION, 1) == 0
    }

    /**
     * locked：冻在当前方向，不跟传感器。
     * free：只在没锁时跟随用户方向（画布）。
     * portrait：正向竖屏，不要倒竖屏。
     */
    @JavascriptInterface
    fun setOrientation(mode: String) {
      runOnUiThread { applyOrientation(mode) }
    }
  }

  private fun applyOrientation(mode: String) {
    orientMode = mode
    val locked = Settings.System.getInt(contentResolver, Settings.System.ACCELEROMETER_ROTATION, 1) == 0
    requestedOrientation = when {
      locked || mode == "locked" -> ActivityInfo.SCREEN_ORIENTATION_LOCKED
      mode == "free" -> ActivityInfo.SCREEN_ORIENTATION_USER
      else -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
  }
}
