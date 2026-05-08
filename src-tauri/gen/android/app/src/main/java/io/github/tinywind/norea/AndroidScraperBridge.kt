package io.github.tinywind.norea

import android.annotation.SuppressLint
import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.ArrayDeque
import kotlin.math.roundToInt
import org.json.JSONObject

class AndroidScraperBridge(private val mainWebView: WebView) {
  private data class CssBounds(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val viewportWidth: Double,
    val viewportHeight: Double,
  )

  private data class NativeBounds(
    val x: Int,
    val y: Int,
    val width: Int,
    val height: Int,
  )

  private enum class QueueKind {
    Background,
    Foreground,
  }

  private data class QueuedAction(
    val id: String,
    val kind: QueueKind,
    val run: () -> Unit,
  )

  private val mainHandler = Handler(Looper.getMainLooper())
  private val queue: ArrayDeque<QueuedAction> = ArrayDeque()
  private var busy = false
  private var scraperWebView: WebView? = null
  private var documentStartScriptEnabled = false
  private var currentUrl: String? = null
  private var activeFetchId: String? = null
  private var activeExtractId: String? = null
  private var activeTimeout: Runnable? = null
  private var browserVisible = false
  private var scraperUserAgent: String? = null
  private var bounds = CssBounds(0.0, 0.0, 1.0, 1.0, 1.0, 1.0)

  @JavascriptInterface
  fun cancel(payload: String) {
    val json = JSONObject(payload)
    val id = json.getString("id")
    val message = json.optString("message", "scraper: cancelled")
    mainHandler.post { cancelById(id, message) }
  }

  @JavascriptInterface
  fun cancelBackground(payload: String) {
    val json = JSONObject(payload)
    val message = json.optString("message", "scraper: background work cancelled")
    mainHandler.post {
      cancelQueuedBackground(message)
      if (busy) cancelActive(message)
    }
  }

  @JavascriptInterface
  fun fetch(payload: String) {
    val json = JSONObject(payload)
    enqueue(
      QueuedAction(json.getString("id"), QueueKind.Background) {
        runFetch(json)
      },
    )
  }

  @JavascriptInterface
  fun extract(payload: String) {
    val json = JSONObject(payload)
    enqueue(
      QueuedAction(json.getString("id"), QueueKind.Background) {
        runExtract(json)
      },
    )
  }

  @JavascriptInterface
  fun navigate(payload: String) {
    val json = JSONObject(payload)
    enqueueForeground(
      QueuedAction(json.getString("id"), QueueKind.Foreground) {
        runNavigate(json)
      },
    )
  }

  @JavascriptInterface
  fun setBounds(payload: String) {
    mainHandler.post {
      val json = JSONObject(payload)
      bounds = CssBounds(
        x = json.optDouble("x", 0.0),
        y = json.optDouble("y", 0.0),
        width = json.optDouble("width", 1.0).coerceAtLeast(1.0),
        height = json.optDouble("height", 1.0).coerceAtLeast(1.0),
        viewportWidth = json.optDouble("viewportWidth", 1.0).coerceAtLeast(1.0),
        viewportHeight = json.optDouble("viewportHeight", 1.0).coerceAtLeast(1.0),
      )
      if (browserVisible) {
        showScraper()
      }
    }
  }

  @JavascriptInterface
  fun hide() {
    mainHandler.post { hideScraper() }
  }

  private fun enqueue(action: QueuedAction) {
    mainHandler.post {
      queue.addLast(action)
      runNext()
    }
  }

  private fun enqueueForeground(action: QueuedAction) {
    mainHandler.post {
      cancelQueued("scraper: interrupted by site browser navigation")
      queue.addFirst(action)
      if (busy) {
        cancelActive("scraper: interrupted by site browser navigation")
      } else {
        runNext()
      }
    }
  }

  private fun runNext() {
    if (busy || queue.isEmpty()) return
    if (browserVisible && queue.first().kind == QueueKind.Background) return
    busy = true
    val action = queue.removeFirst().run
    try {
      action()
    } catch (_: Throwable) {
      busy = false
      runNext()
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun payloadUserAgent(payload: JSONObject): String? {
    val requested =
      if (payload.isNull("userAgent")) "" else payload.optString("userAgent")
    return requested.trim().ifEmpty { mainWebView.settings.userAgentString }
  }

  private fun scraper(userAgent: String?): WebView {
    val existing = scraperWebView
    if (existing != null && scraperUserAgent == userAgent) return existing
    if (existing != null) {
      (existing.parent as? ViewGroup)?.removeView(existing)
      existing.destroy()
      scraperWebView = null
      currentUrl = null
      documentStartScriptEnabled = false
    }

    val webView = WebView(mainWebView.context)
    webView.settings.apply {
      if (!userAgent.isNullOrBlank()) {
        userAgentString = userAgent
      }
      javaScriptEnabled = true
      javaScriptCanOpenWindowsAutomatically = true
      domStorageEnabled = true
      databaseEnabled = true
      mediaPlaybackRequiresUserGesture = false
      mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
      textZoom = 100
    }
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

    webView.addJavascriptInterface(ResultBridge(this), "AndroidScraper")
    documentStartScriptEnabled =
      WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    if (documentStartScriptEnabled) {
      WebViewCompat.addDocumentStartJavaScript(webView, INIT_SCRIPT, setOf("*"))
    }
    webView.webViewClient = makeClient(null)
    webView.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS

    val container = scraperContainer()
    container.addView(webView, hiddenLayoutParams())
    scraperWebView = webView
    scraperUserAgent = userAgent
    hideScraper()
    return webView
  }

  private fun scraperContainer(): ViewGroup {
    val activity = mainWebView.context as? Activity
    return activity?.findViewById(android.R.id.content)
      ?: (mainWebView.parent as? ViewGroup)
      ?: throw IllegalStateException("Android scraper container is unavailable")
  }

  private fun hiddenLayoutParams(): FrameLayout.LayoutParams {
    return FrameLayout.LayoutParams(1, 1).apply {
      leftMargin = -10000
      topMargin = -10000
    }
  }

  private fun visibleLayoutParams(): FrameLayout.LayoutParams {
    val nativeBounds = nativeBounds()
    return FrameLayout.LayoutParams(nativeBounds.width, nativeBounds.height).apply {
      leftMargin = nativeBounds.x
      topMargin = nativeBounds.y
    }
  }

  private fun nativeBounds(): NativeBounds {
    val container = scraperContainer()
    val mainLocation = IntArray(2)
    val containerLocation = IntArray(2)
    mainWebView.getLocationInWindow(mainLocation)
    container.getLocationInWindow(containerLocation)

    val contentWidth =
      (mainWebView.width - mainWebView.paddingLeft - mainWebView.paddingRight).coerceAtLeast(1)
    val contentHeight =
      (mainWebView.height - mainWebView.paddingTop - mainWebView.paddingBottom).coerceAtLeast(1)
    val scaleX = contentWidth / bounds.viewportWidth
    val scaleY = contentHeight / bounds.viewportHeight
    val contentLeft = mainLocation[0] - containerLocation[0] + mainWebView.paddingLeft
    val contentTop = mainLocation[1] - containerLocation[1] + mainWebView.paddingTop

    return NativeBounds(
      x = contentLeft + (bounds.x * scaleX).roundToInt(),
      y = contentTop + (bounds.y * scaleY).roundToInt(),
      width = (bounds.width * scaleX).roundToInt().coerceAtLeast(1),
      height = (bounds.height * scaleY).roundToInt().coerceAtLeast(1),
    )
  }

  private fun showScraper() {
    val webView = scraper(scraperUserAgent ?: mainWebView.settings.userAgentString)
    val container = scraperContainer()
    browserVisible = true
    webView.layoutParams = visibleLayoutParams()
    webView.alpha = 1f
    webView.translationX = 0f
    webView.translationY = 0f
    webView.translationZ = 10_000f
    webView.elevation = 10_000f
    webView.visibility = View.VISIBLE
    webView.isClickable = true
    webView.isFocusable = true
    webView.isFocusableInTouchMode = true
    container.bringChildToFront(webView)
    webView.bringToFront()
    webView.requestLayout()
    webView.invalidate()
  }

  private fun hideScraper() {
    val webView = scraperWebView ?: return
    browserVisible = false
    webView.layoutParams = hiddenLayoutParams()
    webView.alpha = 0f
    webView.translationX = -10000f
    webView.translationY = -10000f
    webView.translationZ = 0f
    webView.isClickable = false
    webView.isFocusable = false
    webView.isFocusableInTouchMode = false
    webView.requestLayout()
    runNext()
  }

  private fun makeClient(onFinished: ((String) -> Unit)?): WebViewClient {
    return object : WebViewClient() {
      override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
        currentUrl = url
        if (!documentStartScriptEnabled) {
          view.evaluateJavascript(INIT_SCRIPT, null)
        }
      }

      override fun onPageFinished(view: WebView, url: String) {
        currentUrl = url
        onFinished?.invoke(url)
      }
    }
  }

  private fun runFetch(payload: JSONObject) {
    val id = payload.getString("id")
    val url = payload.getString("url")
    val contextUrl = payload.optString("contextUrl").takeIf { it.isNotBlank() }
    val init = payload.optJSONObject("init") ?: JSONObject()
    val webView = scraper(payloadUserAgent(payload))
    activeFetchId = id
    hideScraper()

    prepareContext(webView, id, contextUrl) {
      if (activeFetchId != id) return@prepareContext
      setTimeout(id, 60_000L, "scraper: browser fetch to $url timed out")
      val request = JSONObject()
        .put("url", url)
        .put("init", init)
      webView.evaluateJavascript(buildFetchScript(id, request), null)
    }
  }

  private fun runExtract(payload: JSONObject) {
    val id = payload.getString("id")
    val url = payload.getString("url")
    val beforeScript = payload.optString("beforeScript").takeIf { it.isNotEmpty() }
    val timeoutMs = payload.optLong("timeoutMs", 30_000L)
    val targetUrl = if (beforeScript != null) {
      val base = url.substringBefore("#")
      "$base#__lnr_script__=${Uri.encode(beforeScript)}"
    } else {
      url
    }

    activeExtractId = id
    setTimeout(id, timeoutMs, "webview_extract: timeout after ${timeoutMs}ms")
    val webView = scraper(payloadUserAgent(payload))
    hideScraper()
    webView.loadUrl(targetUrl)
  }

  private fun runNavigate(payload: JSONObject) {
    val id = payload.getString("id")
    val url = payload.getString("url")
    val webView = scraper(payloadUserAgent(payload))
    showScraper()
    webView.loadUrl(url)
    finishSuccess(id, true)
  }

  private fun prepareContext(
    webView: WebView,
    id: String,
    contextUrl: String?,
    ready: () -> Unit,
  ) {
    if (contextUrl == null || sameOrigin(currentUrl, contextUrl)) {
      ready()
      return
    }

    var finished = false
    val timeout = Runnable {
      if (finished) return@Runnable
      finished = true
      webView.stopLoading()
      webView.webViewClient = makeClient(null)
      finishError(id, "scraper: timed out preparing fetch context $contextUrl")
    }
    activeTimeout = timeout
    mainHandler.postDelayed(timeout, 15_000L)
    webView.webViewClient = makeClient {
      if (finished) return@makeClient
      finished = true
      clearTimeout()
      webView.webViewClient = makeClient(null)
      ready()
    }
    webView.loadUrl(contextUrl)
  }

  private fun sameOrigin(left: String?, right: String): Boolean {
    if (left == null) return false
    val leftUri = Uri.parse(left)
    val rightUri = Uri.parse(right)
    return leftUri.scheme == rightUri.scheme &&
      leftUri.host == rightUri.host &&
      effectivePort(leftUri) == effectivePort(rightUri)
  }

  private fun effectivePort(uri: Uri): Int {
    if (uri.port != -1) return uri.port
    return when (uri.scheme) {
      "http" -> 80
      "https" -> 443
      else -> -1
    }
  }

  private fun setTimeout(id: String, timeoutMs: Long, message: String) {
    clearTimeout()
    val timeout = Runnable { finishError(id, message) }
    activeTimeout = timeout
    mainHandler.postDelayed(timeout, timeoutMs)
  }

  private fun clearTimeout() {
    activeTimeout?.let { mainHandler.removeCallbacks(it) }
    activeTimeout = null
  }

  private fun finishSuccess(id: String, result: Any) {
    finish(
      id,
      JSONObject()
        .put("ok", true)
        .put("result", result),
    )
  }

  private fun finishError(id: String, message: String) {
    finish(
      id,
      JSONObject()
        .put("ok", false)
        .put("error", message),
    )
  }

  private fun cancelQueued(message: String) {
    cancelQueuedWhere(message) { true }
  }

  private fun cancelQueuedBackground(message: String) {
    cancelQueuedWhere(message) { it.kind == QueueKind.Background }
  }

  private fun cancelQueuedWhere(message: String, shouldCancel: (QueuedAction) -> Boolean) {
    val remaining: ArrayDeque<QueuedAction> = ArrayDeque()
    while (queue.isNotEmpty()) {
      val action = queue.removeFirst()
      if (shouldCancel(action)) {
        sendError(action.id, message)
      } else {
        remaining.addLast(action)
      }
    }
    queue.addAll(remaining)
  }

  private fun cancelById(id: String, message: String) {
    val remaining: ArrayDeque<QueuedAction> = ArrayDeque()
    var cancelledQueued = false
    while (queue.isNotEmpty()) {
      val action = queue.removeFirst()
      if (action.id == id) {
        cancelledQueued = true
        sendError(action.id, message)
      } else {
        remaining.addLast(action)
      }
    }
    queue.addAll(remaining)
    if (cancelledQueued) return
    if (activeFetchId == id || activeExtractId == id) {
      cancelActive(message)
    }
  }

  private fun cancelActive(message: String) {
    val fetchId = activeFetchId
    val id = fetchId ?: activeExtractId
    if (fetchId != null) abortActiveFetch(fetchId)
    scraperWebView?.stopLoading()
    if (id == null) {
      clearTimeout()
      busy = false
      runNext()
      return
    }
    finishError(id, message)
  }

  private fun abortActiveFetch(id: String) {
    val quotedId = JSONObject.quote(id)
    scraperWebView?.evaluateJavascript(
      "window.__noreaAndroidFetchControllers && window.__noreaAndroidFetchControllers[$quotedId] && window.__noreaAndroidFetchControllers[$quotedId].abort();",
      null,
    )
  }

  private fun sendError(id: String, message: String) {
    sendResult(
      id,
      JSONObject()
        .put("ok", false)
        .put("error", message),
    )
  }

  private fun finish(id: String, envelope: JSONObject) {
    clearTimeout()
    activeFetchId = null
    activeExtractId = null
    sendResult(id, envelope)
    busy = false
    runNext()
  }

  private fun sendResult(id: String, envelope: JSONObject) {
    val script =
      "window.__lnrAndroidScraperResolve(${JSONObject.quote(id)}, ${JSONObject.quote(envelope.toString())});"
    mainWebView.evaluateJavascript(script, null)
  }

  private fun onFetchResult(id: String, payload: String) {
    if (activeFetchId != id) return
    try {
      val result = JSONObject(payload)
      if (!result.optBoolean("success", false)) {
        finishError(id, result.optString("error", "unknown browser fetch error"))
        return
      }
      result.remove("success")
      finishSuccess(id, result)
    } catch (error: Throwable) {
      finishError(id, "scraper: invalid browser fetch result: ${error.message}")
    }
  }

  private fun onExtractResult(payload: String) {
    val id = activeExtractId ?: return
    scraperWebView?.loadUrl("about:blank")
    finishSuccess(id, payload)
  }

  private class ResultBridge(private val owner: AndroidScraperBridge) {
    @JavascriptInterface
    fun postFetchResult(id: String, payload: String) {
      owner.mainHandler.post { owner.onFetchResult(id, payload) }
    }

    @JavascriptInterface
    fun postExtractResult(payload: String) {
      owner.mainHandler.post { owner.onExtractResult(payload) }
    }
  }

  private fun buildFetchScript(id: String, request: JSONObject): String {
    return """
      (function () {
        const request = ${request};
        const requestId = ${JSONObject.quote(id)};
        const blockedHeaders = new Set([
          "accept-charset", "accept-encoding", "access-control-request-headers",
          "access-control-request-method", "connection", "content-length", "cookie",
          "cookie2", "date", "dnt", "expect", "host", "keep-alive", "origin",
          "referer", "te", "trailer", "transfer-encoding", "upgrade", "via",
          "user-agent"
        ]);
        (async function () {
          try {
            const init = request.init || {};
            const controllers = window.__noreaAndroidFetchControllers || (window.__noreaAndroidFetchControllers = {});
            const controller = new AbortController();
            controllers[requestId] = controller;
            const headers = new Headers();
            for (const key of Object.keys(init.headers || {})) {
              if (!blockedHeaders.has(key.toLowerCase())) {
                headers.set(key, String(init.headers[key]));
              }
            }
            const fetchInit = {
              method: init.method || "GET",
              headers,
              credentials: "include",
              redirect: "follow",
              signal: controller.signal
            };
            if (init.body !== undefined && init.body !== null) {
              fetchInit.body = init.body;
            }
            const response = await fetch(request.url, fetchInit);
            const responseHeaders = {};
            response.headers.forEach(function (value, key) {
              responseHeaders[key] = value;
            });
            const responseBytes = new Uint8Array(await response.arrayBuffer());
            const responseChunks = [];
            const chunkSize = 0x8000;
            for (let offset = 0; offset < responseBytes.length; offset += chunkSize) {
              const chunk = responseBytes.subarray(offset, offset + chunkSize);
              responseChunks.push(String.fromCharCode.apply(null, Array.from(chunk)));
            }
            const bodyBase64 = btoa(responseChunks.join(""));
            AndroidScraper.postFetchResult(requestId, JSON.stringify({
              success: true,
              status: response.status,
              statusText: response.statusText || "",
              bodyBase64,
              headers: responseHeaders,
              finalUrl: response.url || request.url
            }));
          } catch (error) {
            AndroidScraper.postFetchResult(requestId, JSON.stringify({
              success: false,
              error: (error && (error.message || error.toString())) || String(error)
            }));
          } finally {
            try {
              delete window.__noreaAndroidFetchControllers[requestId];
            } catch (e) {}
          }
        })();
      })();
    """.trimIndent()
  }

  companion object {
    private val INIT_SCRIPT = """
      (function () {
        window.ReactNativeWebView = window.ReactNativeWebView || {};
        window.ReactNativeWebView.postMessage = function (payload) {
          try {
            AndroidScraper.postExtractResult(String(payload));
          } catch (e) {}
        };
        try {
          var hash = location.hash || "";
          var prefix = "#__lnr_script__=";
          var idx = hash.indexOf(prefix);
          if (idx !== -1) {
            var encoded = hash.substring(idx + prefix.length);
            var script = decodeURIComponent(encoded);
            try {
              history.replaceState(null, "", location.pathname + location.search);
            } catch (e) {}
            try {
              (0, eval)(script);
            } catch (e) {
              var msg = (e && e.message) || String(e);
              try {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  ok: false,
                  error: "before-script error: " + msg
                }));
              } catch (e2) {}
            }
          }
        } catch (e) {}
      })();
    """.trimIndent()
  }
}
