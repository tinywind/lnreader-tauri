package io.github.tinywind.lnreader_tauri

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var androidScraperBridge: AndroidScraperBridge? = null
  @Volatile
  private var safeAreaInsetsJson = insetsJson(Insets.NONE)

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    val bridge = AndroidScraperBridge(webView)
    androidScraperBridge = bridge
    webView.addJavascriptInterface(bridge, "__LNReaderAndroidScraper")
    webView.addJavascriptInterface(SafeAreaBridge(), "__LNReaderAndroidSafeArea")
    webView.addJavascriptInterface(WindowMetricsBridge(webView), "__LNReaderAndroidWindow")
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
      loadWithOverviewMode = false
      useWideViewPort = true
      textZoom = 100
    }
    webView.setInitialScale(100)

    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, windowInsets ->
      val types = WindowInsetsCompat.Type.systemBars() or
        WindowInsetsCompat.Type.displayCutout()
      val insets = windowInsets.getInsets(types)
      safeAreaInsetsJson = insetsJson(insets)
      val script =
        "window.__lnrApplyAndroidSafeAreaInsets && window.__lnrApplyAndroidSafeAreaInsets($safeAreaInsetsJson);"
      webView.evaluateJavascript(
        script,
        null,
      )

      windowInsets
    }
    ViewCompat.requestApplyInsets(webView)
  }

  private inner class SafeAreaBridge {
    @JavascriptInterface
    fun getInsets(): String = safeAreaInsetsJson
  }

  private inner class WindowMetricsBridge(private val webView: WebView) {
    @JavascriptInterface
    fun getMetrics(): String = windowMetricsJson(webView)
  }

  private fun windowMetricsJson(webView: WebView): String {
    val metrics = resources.displayMetrics
    val density = if (metrics.density > 0f) metrics.density else 1f
    val widthPx = if (webView.width > 0) webView.width else metrics.widthPixels
    val heightPx = if (webView.height > 0) webView.height else metrics.heightPixels

    return JSONObject()
      .put("widthPx", widthPx)
      .put("heightPx", heightPx)
      .put("density", density.toDouble())
      .put("widthDp", widthPx / density)
      .put("heightDp", heightPx / density)
      .toString()
  }

  companion object {
    private fun insetsJson(insets: Insets): String {
      return JSONObject()
        .put("top", insets.top)
        .put("right", insets.right)
        .put("bottom", insets.bottom)
        .put("left", insets.left)
        .toString()
    }
  }
}
