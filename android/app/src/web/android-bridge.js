// Loaded only inside the Android app (added by android/app/build.gradle.kts). Android's WebView has no
// built-in speech or printing, so these route to the app's ResusAndroid interface instead.
(function () {
    var app = window.ResusAndroid;
    if (!app) return;

    window.print = function () { app.print(); };

    if (!('speechSynthesis' in window)) {
        window.SpeechSynthesisUtterance = function (text) {
            this.text = text; this.lang = 'en-GB'; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1;
        };
        window.speechSynthesis = {
            speaking: false, pending: false, paused: false,
            speak: function (u) {
                // The page primes speech with a silent, blank utterance on the first tap; skip that one
                if (!u || !u.text || !String(u.text).trim() || u.volume === 0) return;
                // Newer app versions answer true/false; false means the phone's speech engine did not start
                var ok = app.speak(String(u.text), Number(u.rate) || 1);
                if (ok === false || ok === true) {
                    try { window.dispatchEvent(new Event(ok ? 'resus-speech-ok' : 'resus-speech-failed')); } catch (e) { /* ignore */ }
                }
            },
            cancel: function () { app.stopSpeaking(); },
            pause: function () {}, resume: function () {},
            getVoices: function () { return [{ name: 'Android', lang: 'en-GB', default: true, localService: true, voiceURI: 'android' }]; },
            addEventListener: function () {}, removeEventListener: function () {}
        };
    }
})();
