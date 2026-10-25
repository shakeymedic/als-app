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
                app.speak(String(u.text), Number(u.rate) || 1);
            },
            cancel: function () { app.stopSpeaking(); },
            pause: function () {}, resume: function () {},
            getVoices: function () { return [{ name: 'Android', lang: 'en-GB', default: true, localService: true, voiceURI: 'android' }]; },
            addEventListener: function () {}, removeEventListener: function () {}
        };
    }
})();
