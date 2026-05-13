package io.github.tinywind.norea

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.documentfile.provider.DocumentFile
import androidx.core.graphics.Insets
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File

class MainActivity : TauriActivity() {
  private var androidScraperBridge: AndroidScraperBridge? = null
  private var scraperBackPressedCallback: OnBackPressedCallback? = null
  private var mainWebView: WebView? = null
  private var notificationPermissionRequested = false
  private var pendingStorageRootRequestId: String? = null
  @Volatile
  private var safeAreaInsetsJson = insetsJson(Insets.NONE)

  override fun onCreate(savedInstanceState: Bundle?) {
    RustlsPlatformVerifierBridge.init(applicationContext)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    mainWebView = webView
    val bridge = AndroidScraperBridge(webView)
    androidScraperBridge = bridge
    webView.addJavascriptInterface(bridge, "__NoreaAndroidScraper")
    webView.addJavascriptInterface(SafeAreaBridge(), "__NoreaAndroidSafeArea")
    webView.addJavascriptInterface(TaskNotificationBridge(), "__NoreaAndroidTasks")
    webView.addJavascriptInterface(UpdateInstallBridge(), "__NoreaAndroidUpdater")
    webView.addJavascriptInterface(StorageBridge(), "__NoreaAndroidStorage")
    webView.addJavascriptInterface(WindowMetricsBridge(webView), "__NoreaAndroidWindow")
    webView.settings.apply {
      setSupportZoom(false)
      builtInZoomControls = false
      displayZoomControls = false
      loadWithOverviewMode = false
      useWideViewPort = true
      textZoom = 100
    }
    webView.setInitialScale(100)
    installScraperBackHandler()

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

  private fun installScraperBackHandler() {
    scraperBackPressedCallback?.remove()
    scraperBackPressedCallback = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (androidScraperBridge?.handleBackPressed() == true) return
        isEnabled = false
        try {
          onBackPressedDispatcher.onBackPressed()
        } finally {
          isEnabled = true
        }
      }
    }.also { callback ->
      // Register after Tauri creates its WebView so source-browser back wins.
      onBackPressedDispatcher.addCallback(this, callback)
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_MEDIA_STORAGE_ROOT) return

    val requestId = pendingStorageRootRequestId ?: return
    pendingStorageRootRequestId = null
    if (resultCode != Activity.RESULT_OK) {
      resolveStorageRootPick(
        requestId,
        JSONObject()
          .put("ok", false)
          .put("cancelled", true),
      )
      return
    }

    val uri = data?.data
    if (uri == null) {
      resolveStorageRootPick(
        requestId,
        JSONObject()
          .put("ok", false)
          .put("error", "No storage folder was selected."),
      )
      return
    }

    val flags = data.flags and (
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      )
    runCatching {
      contentResolver.takePersistableUriPermission(uri, flags)
      uri.toString()
    }.fold(
      onSuccess = { root ->
        resolveStorageRootPick(
          requestId,
          JSONObject()
            .put("ok", true)
            .put("root", root),
        )
      },
      onFailure = { error ->
        resolveStorageRootPick(
          requestId,
          JSONObject()
            .put("ok", false)
            .put("error", error.message ?: error.toString()),
        )
      },
    )
  }

  private inner class SafeAreaBridge {
    @JavascriptInterface
    fun getInsets(): String = safeAreaInsetsJson
  }

  private inner class TaskNotificationBridge {
    @JavascriptInterface
    fun update(payload: String) {
      runOnUiThread {
        try {
          try {
            requestNotificationPermissionIfNeeded()
          } catch (_: Throwable) {
            // Permission prompts are best-effort; task execution must continue.
          }
          val json = JSONObject(payload)
          val progress = json.optJSONObject("progress")
          val current = progress?.takeIf { it.has("current") }?.optInt("current")
          val total = progress?.takeIf { it.has("total") }?.optInt("total")
          TaskForegroundService.update(
            this@MainActivity,
            json.optString("title", "Norea tasks"),
            json.optString("body", ""),
            current,
            total,
          )
        } catch (_: Throwable) {
          // Ignore malformed bridge payloads so task execution is not affected.
        }
      }
    }

    @JavascriptInterface
    fun stop() {
      runOnUiThread {
        try {
          TaskForegroundService.stop(this@MainActivity)
        } catch (_: Throwable) {
          // The service may already be stopped by Android.
        }
      }
    }
  }

  private inner class UpdateInstallBridge {
    @JavascriptInterface
    fun openApk(path: String): String =
      runCatching {
        val apk = File(path)
        require(apk.exists()) { "APK file does not exist." }
        require(apk.extension.equals("apk", ignoreCase = true)) {
          "Update file is not an APK."
        }

        val uri = FileProvider.getUriForFile(
          this@MainActivity,
          "$packageName.fileprovider",
          apk,
        )
        startActivity(apkInstallIntent(uri))
      }.fold(
        onSuccess = { JSONObject().put("ok", true).toString() },
        onFailure = { error ->
          JSONObject()
            .put("ok", false)
            .put("error", error.message ?: error.toString())
            .toString()
        },
      )
  }

  private inner class StorageBridge {
    @JavascriptInterface
    fun pickMediaStorageRoot(requestId: String) {
      runOnUiThread {
        if (pendingStorageRootRequestId != null) {
          resolveStorageRootPick(
            requestId,
            JSONObject()
              .put("ok", false)
              .put("error", "A storage folder picker is already open."),
          )
          return@runOnUiThread
        }

        pendingStorageRootRequestId = requestId
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
          addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
          addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
          putExtra("android.content.extra.SHOW_ADVANCED", true)
        }
        runCatching {
          startActivityForResult(intent, REQUEST_MEDIA_STORAGE_ROOT)
        }.onFailure { error ->
          pendingStorageRootRequestId = null
          resolveStorageRootPick(
            requestId,
            JSONObject()
              .put("ok", false)
              .put("error", error.message ?: error.toString()),
          )
        }
      }
    }

    @JavascriptInterface
    fun writeBytes(
      rootUri: String,
      relativePath: String,
      base64: String,
      mimeType: String,
    ): String = storageResponse {
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      val file = ensureStorageFile(rootUri, relativePath, mimeTypeForPath(relativePath, mimeType))
      contentResolver.openOutputStream(file.uri, "wt")?.use { output ->
        output.write(bytes)
      } ?: throw IllegalStateException("Cannot open storage file for writing.")
      JSONObject()
        .put("ok", true)
        .put("bytes", bytes.size)
    }

    @JavascriptInterface
    fun writeText(rootUri: String, relativePath: String, text: String): String =
      storageResponse {
        val bytes = text.toByteArray(Charsets.UTF_8)
        val file = ensureStorageFile(
          rootUri,
          relativePath,
          textMimeTypeForPath(relativePath),
        )
        contentResolver.openOutputStream(file.uri, "wt")?.use { output ->
          output.write(bytes)
        } ?: throw IllegalStateException("Cannot open storage file for writing.")
        JSONObject()
          .put("ok", true)
          .put("bytes", bytes.size)
      }

    @JavascriptInterface
    fun readText(rootUri: String, relativePath: String): String = storageResponse {
      val file = storageDocumentAt(rootUri, relativePath)
        ?: throw IllegalArgumentException("Android storage path not found: $relativePath")
      val text = contentResolver.openInputStream(file.uri)?.use { input ->
        input.readBytes().toString(Charsets.UTF_8)
      } ?: throw IllegalStateException("Cannot open storage file for reading.")
      JSONObject()
        .put("ok", true)
        .put("text", text)
    }

    @JavascriptInterface
    fun readBase64(rootUri: String, relativePath: String): String = storageResponse {
      val file = storageDocumentAt(rootUri, relativePath)
        ?: throw IllegalArgumentException("Android storage path not found: $relativePath")
      val bytes = contentResolver.openInputStream(file.uri)?.use { input ->
        input.readBytes()
      } ?: throw IllegalStateException("Cannot open storage file for reading.")
      JSONObject()
        .put("ok", true)
        .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        .put("mimeType", mimeTypeForPath(relativePath, ""))
    }

    @JavascriptInterface
    fun pathSize(rootUri: String, relativePath: String): String = storageResponse {
      val document = storageDocumentAt(rootUri, relativePath)
      JSONObject()
        .put("ok", true)
        .put("bytes", document?.let(::storageDocumentSize) ?: 0L)
    }

    @JavascriptInterface
    fun deletePath(rootUri: String, relativePath: String): String = storageResponse {
      storageDocumentAt(rootUri, relativePath)?.delete()
      JSONObject().put("ok", true)
    }

    @JavascriptInterface
    fun deleteChildrenExcept(rootUri: String, relativePath: String, keepName: String): String =
      storageResponse {
        storageDocumentAt(rootUri, relativePath)?.listFiles()?.forEach { child ->
          if (child.name != keepName) {
            child.delete()
          }
        }
        JSONObject().put("ok", true)
      }

    @JavascriptInterface
    fun deleteRootChildren(rootUri: String): String = storageResponse {
      storageRoot(rootUri).listFiles().forEach { child ->
        child.delete()
      }
      JSONObject().put("ok", true)
    }
  }

  private inner class WindowMetricsBridge(private val webView: WebView) {
    @JavascriptInterface
    fun getMetrics(): String = windowMetricsJson(webView)
  }

  private fun apkInstallIntent(uri: Uri): Intent =
    Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, APK_MIME_TYPE)
      clipData = ClipData.newUri(contentResolver, "Norea update", uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (notificationPermissionRequested) return
    if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    notificationPermissionRequested = true
    requestPermissions(
      arrayOf(Manifest.permission.POST_NOTIFICATIONS),
      REQUEST_POST_NOTIFICATIONS,
    )
  }

  private fun resolveStorageRootPick(requestId: String, payload: JSONObject) {
    val script =
      "window.__lnrResolveAndroidStoragePick && window.__lnrResolveAndroidStoragePick(" +
        "${JSONObject.quote(requestId)}, $payload);"
    mainWebView?.post {
      mainWebView?.evaluateJavascript(script, null)
    }
  }

  private fun storageResponse(block: () -> JSONObject): String =
    runCatching(block).fold(
      onSuccess = { it.toString() },
      onFailure = { error ->
        JSONObject()
          .put("ok", false)
          .put("error", error.message ?: error.toString())
          .toString()
      },
    )

  private fun storageRoot(rootUri: String): DocumentFile =
    DocumentFile.fromTreeUri(this, Uri.parse(rootUri))
      ?: throw IllegalArgumentException("Android storage folder is unavailable.")

  private fun safeStorageSegments(relativePath: String): List<String> {
    val segments = relativePath
      .replace('\\', '/')
      .split('/')
      .map { it.trim() }
      .filter { it.isNotEmpty() }
    require(segments.isNotEmpty()) { "Android storage path is empty." }
    for (segment in segments) {
      require(segment != "." && segment != ".." && !segment.contains('\u0000')) {
        "Android storage path contains an invalid segment."
      }
    }
    return segments
  }

  private fun storageDocumentAt(rootUri: String, relativePath: String): DocumentFile? {
    var current = storageRoot(rootUri)
    for (segment in safeStorageSegments(relativePath)) {
      current = current.findFile(segment) ?: return null
    }
    return current
  }

  private fun ensureStorageDirectory(parent: DocumentFile, name: String): DocumentFile {
    val existing = parent.findFile(name)
    if (existing != null) {
      require(existing.isDirectory) { "Android storage path segment is not a folder: $name" }
      return existing
    }
    return parent.createDirectory(name)
      ?: throw IllegalStateException("Cannot create Android storage folder: $name")
  }

  private fun ensureStorageFile(
    rootUri: String,
    relativePath: String,
    mimeType: String,
  ): DocumentFile {
    val segments = safeStorageSegments(relativePath)
    var current = storageRoot(rootUri)
    for (segment in segments.dropLast(1)) {
      current = ensureStorageDirectory(current, segment)
    }
    val fileName = segments.last()
    val existing = current.findFile(fileName)
    if (existing != null) {
      require(existing.isFile) { "Android storage path is not a file: $relativePath" }
      return existing
    }
    val created = current.createFile(mimeType, fileName)
    if (created != null) return created
    val raced = current.findFile(fileName)
    if (raced != null) {
      require(raced.isFile) { "Android storage path is not a file: $relativePath" }
      return raced
    }
    throw IllegalStateException("Cannot create Android storage file: $relativePath")
  }

  private fun textMimeTypeForPath(relativePath: String): String {
    val mimeType = mimeTypeForPath(relativePath, "")
    return if (mimeType == "application/octet-stream") "text/plain" else mimeType
  }

  private fun mimeTypeForPath(relativePath: String, fallback: String): String {
    if (fallback.isNotBlank()) return fallback
    val extension = relativePath.substringAfterLast('.', "")
      .lowercase()
      .takeIf { it.isNotBlank() }
    return extension
      ?.let { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) }
      ?: "application/octet-stream"
  }

  private fun storageDocumentSize(document: DocumentFile): Long =
    if (document.isDirectory) {
      document.listFiles().sumOf(::storageDocumentSize)
    } else {
      document.length().coerceAtLeast(0L)
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
    private const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    private const val REQUEST_MEDIA_STORAGE_ROOT = 1001
    private const val REQUEST_POST_NOTIFICATIONS = 1002

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
