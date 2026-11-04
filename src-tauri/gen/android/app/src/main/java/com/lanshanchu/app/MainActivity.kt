package com.lanshanchu.app

import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 默认深色底用浅色系统图标。应用内切到浅色后，由页面调用 LanshanBars。
    applySystemBarIcons(darkPage = true)
  }

  override fun onResume() {
    super.onResume()
    hookWebView()
  }

  private fun applySystemBarIcons(darkPage: Boolean) {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    // true 表示深色图标，用在浅色页面上。
    controller.isAppearanceLightStatusBars = !darkPage
    controller.isAppearanceLightNavigationBars = !darkPage
  }

  private fun hookWebView() {
    val root = window.decorView as? ViewGroup ?: return
    val web = findWebView(root) ?: return
    // 关掉系统 WebView 整页缩放；地图捏合由前端 stage 手势处理
    web.settings.setSupportZoom(false)
    web.settings.builtInZoomControls = false
    web.settings.displayZoomControls = false
    web.addJavascriptInterface(BarBridge(), "LanshanBars")
    web.addJavascriptInterface(ShareBridge(), "LanshanShare")
    web.addJavascriptInterface(AppBridge(), "LanshanApp")
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
  }
}
