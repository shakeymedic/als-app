package org.emevidence.resusassist

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.speech.tts.TextToSpeech
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.util.Locale

/**
 * The whole web app is bundled inside the app (assets/site, copied from ../index.html by the build), so it
 * works with no signal. Pages are served from https://appassets.androidplatform.net/assets/site/ so they
 * behave exactly like the website, including local storage for the current record.
 */
class MainActivity : ComponentActivity(), TextToSpeech.OnInitListener {

    private lateinit var webView: WebView
    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Used during an arrest: the screen must not lock or dim while the app is open
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        tts = TextToSpeech(this, this)

        val container = FrameLayout(this)
        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(0xFFFFFFFF.toInt())
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            // The countdown beeps and metronome start from timers, not straight from a tap
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = "${settings.userAgentString} ResusAssistApp/${BuildConfig.VERSION_NAME}"
            // Only the bundled pages are ever shown in this WebView (every other link opens outside the app)
            addJavascriptInterface(Bridge(), "ResusAndroid")
            webViewClient = Client()
        }
        container.addView(webView)
        setContentView(container)

        // Keep content clear of the status bar, navigation bar and camera cut-out (edge-to-edge is enforced on Android 15+)
        ViewCompat.setOnApplyWindowInsetsListener(container) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        // Back must not close the app by accident in the middle of an arrest
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) { webView.goBack(); return }
                AlertDialog.Builder(this@MainActivity)
                    .setMessage(R.string.confirm_close)
                    .setPositiveButton(R.string.close) { _, _ -> finish() }
                    .setNegativeButton(R.string.stay, null)
                    .show()
            }
        })

        if (savedInstanceState != null) webView.restoreState(savedInstanceState) else webView.loadUrl(HOME)
    }

    override fun onInit(status: Int) {
        val engine = tts ?: return
        if (status != TextToSpeech.SUCCESS) return
        if (engine.setLanguage(Locale.UK) < TextToSpeech.LANG_AVAILABLE) engine.setLanguage(Locale.ENGLISH)
        ttsReady = true
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        tts?.shutdown()
        tts = null
        webView.destroy()
        super.onDestroy()
    }

    /** What android-bridge.js calls in place of the browser's speech and printing. */
    inner class Bridge {
        @JavascriptInterface
        fun speak(text: String, rate: Float) {
            val engine = tts ?: return
            if (!ttsReady) return
            engine.setSpeechRate(rate.coerceIn(0.5f, 2f))
            engine.speak(text.take(TextToSpeech.getMaxSpeechInputLength()), TextToSpeech.QUEUE_ADD, null, "resus")
        }

        @JavascriptInterface
        fun stopSpeaking() {
            if (ttsReady) tts?.stop()
        }

        @JavascriptInterface
        fun print() {
            runOnUiThread {
                val printManager = getSystemService(PRINT_SERVICE) as PrintManager
                val name = getString(R.string.app_name) + " record"
                printManager.print(name, webView.createPrintDocumentAdapter(name), PrintAttributes.Builder().build())
            }
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assetLoader.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (request.url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
            // The RCUK guideline PDFs and any other link open in the phone's own apps
            try {
                startActivity(Intent(Intent.ACTION_VIEW, request.url).addCategory(Intent.CATEGORY_BROWSABLE))
            } catch (e: ActivityNotFoundException) {
                Toast.makeText(this@MainActivity, R.string.no_app_for_link, Toast.LENGTH_LONG).show()
            }
            return true
        }
    }

    companion object {
        private const val HOME = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/site/index.html"
    }
}
