package com.lanshanchu.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 产品默认深色底；系统若是浅色模式，DayNight 会给黑图标，叠在 #141726 上看不见。
    // 先统一用浅色系统图标；跟应用内浅/深主题联动以后再接。
    applyLightSystemBarIcons()
  }

  override fun onResume() {
    super.onResume()
    applyLightSystemBarIcons()
  }

  private fun applyLightSystemBarIcons() {
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    controller.isAppearanceLightStatusBars = false
    controller.isAppearanceLightNavigationBars = false
  }
}
