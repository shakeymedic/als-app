package org.emevidence.resusassist

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.print.PrintAttributes
import android.print.PrintManager
import android.speech.tts.TextToSpeech
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
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

    private lateinit var container: FrameLayout
    private lateinit var webView: WebView
    private var tts: TextToSpeech? = null
    @Volatile private var ttsReady = false
    @Volatile private var ttsFailed = false
    private var lastRendererRestart = 0L

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

        // The volume keys should change the media volume (which the beeps and speech use), not the ringer
        volumeControlStream = AudioManager.STREAM_MUSIC

        container = FrameLayout(this)
        webView = createWebView()
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

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun createWebView(): WebView = WebView(this).apply {
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

    /**
     * Android can kill the WebView's renderer (low memory, or a renderer crash). Without this the whole app
     * would be closed in the middle of an arrest. The dead WebView cannot be reused, so it is replaced and
     * the page loaded again; the page restores the record in progress from local storage, and its timers
     * run from saved clock times, so nothing is lost.
     */
    private fun recoverFromRendererLoss(dead: WebView) {
        if (dead !== webView || isFinishing || isDestroyed) return
        container.removeView(dead)
        dead.destroy()
        val now = SystemClock.elapsedRealtime()
        val restartedRecently = lastRendererRestart != 0L && now - lastRendererRestart < RENDERER_RESTART_WINDOW_MS
        lastRendererRestart = now
        webView = createWebView()
        container.addView(webView)
        if (restartedRecently) {
            // Two losses close together: do not reload in a loop. Close cleanly and say why (the record is saved).
            Toast.makeText(this, R.string.renderer_failed, Toast.LENGTH_LONG).show()
            finish()
            return
        }
        webView.loadUrl(HOME)
    }

    override fun onInit(status: Int) {
        val engine = tts ?: return
        if (status != TextToSpeech.SUCCESS) { ttsFailed = true; return }
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
        container.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }

    /** What android-bridge.js calls in place of the browser's speech and printing. */
    inner class Bridge {
        /** Returns false when the phone's speech engine failed to start or refused the text, so the page can say so. */
        @JavascriptInterface
        fun speak(text: String, rate: Float): Boolean {
            val engine = tts ?: return false
            if (ttsFailed) return false
            if (!ttsReady) return true // still starting up: nothing is spoken yet, but that is not a failure
            engine.setSpeechRate(rate.coerceIn(0.5f, 2f))
            return engine.speak(text.take(TextToSpeech.getMaxSpeechInputLength()), TextToSpeech.QUEUE_ADD, null, "resus") == TextToSpeech.SUCCESS
        }

        /** Media volume as a percentage (0 = silent). The beeps and the spoken prompts both follow it. */
        @JavascriptInterface
        fun mediaVolume(): Int {
            val audio = getSystemService(AUDIO_SERVICE) as AudioManager
            val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            if (max <= 0) return 100
            val now = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
            return if (now <= 0 || audio.isStreamMute(AudioManager.STREAM_MUSIC)) 0 else maxOf(1, now * 100 / max)
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
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Must not touch the dead WebView inside this callback's stack: do the swap on the next loop
            Handler(Looper.getMainLooper()).post { recoverFromRendererLoss(view) }
            return true
        }

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
        private const val RENDERER_RESTART_WINDOW_MS = 10_000L
        private const val HOME = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/site/index.html"
    }
}
