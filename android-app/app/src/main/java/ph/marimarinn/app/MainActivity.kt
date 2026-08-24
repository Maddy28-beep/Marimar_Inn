package ph.marimarinn.app

import android.Manifest
import android.annotation.SuppressLint
import android.os.Build
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val printerBridge = PrinterBridge()

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { loadApp() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.javaScriptCanOpenWindowsAutomatically = true
        // Forcing LAYER_TYPE_HARDWARE here used to sit on top of the window's
        // own hardwareAccelerated="true" (manifest) — a second, redundant
        // GPU-backed layer that has to be fully reallocated at the new
        // dimensions on every rotation. On the low-RAM tablets this app
        // actually runs on, that reallocation was the multi-second freeze
        // reported on every orientation flip. The window-level flag alone is
        // enough; WebView's own default layer type is lighter.

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.webViewClient = object : WebViewClient() {
            // Without this override, Android's default behavior when the
            // WebView's renderer process is killed (low-memory tablets doing
            // this under any GPU/memory pressure, e.g. right after the
            // layer-type fix above but not eliminated by it) is to crash the
            // whole app outright, forcing the cashier to manually reopen it.
            // Recreating the activity instead gets them back to a working
            // screen on its own.
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(printerBridge, "MarimarNativePrinter")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissionLauncher.launch(
                arrayOf(
                    Manifest.permission.BLUETOOTH_CONNECT,
                    Manifest.permission.BLUETOOTH_SCAN,
                )
            )
        } else {
            loadApp()
        }
    }

    private fun loadApp() {
        webView.loadUrl("${getString(R.string.app_url)}?v=${BuildConfig.VERSION_NAME}")
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
