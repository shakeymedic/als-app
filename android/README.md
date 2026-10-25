# Resus Assist for Android

The Android app bundles the web app (`../index.html`, `../vendor`, `../icons`) and shows it full screen in a
WebView, the same way as the HALO QRH app. Everything is inside the app, so it works with no signal from the
very first launch and never depends on the website being up.

What the app adds to the web page:

- **Spoken prompts.** Android's WebView has no built-in speech, so `app/src/web/android-bridge.js` routes the
  page's speech to the phone's own text-to-speech engine (UK English where installed). It works offline once
  the phone has an offline voice, which Samsung and Google voices normally do.
- **Printing.** The record summary's Print button opens Android's print screen (print or save as PDF).
- **Screen stays on** while the app is open.
- **Back button** asks before closing, so the app is not closed by accident during an arrest. The current
  record stays saved on the phone for 12 hours either way, as on the website.
- The EM Evidence logo is bundled (the website hotlinks it), and guideline links open in the phone's browser.

The build copies the web app and makes these changes to `index.html` (`copySite` in `app/build.gradle.kts`).
It fails if `index.html` changes in a way that stops them applying.

## Get a test APK

GitHub, **Actions**, **Android app**, the latest run, then the **resus-assist-android** artifact. Unzip it and
install `app-debug.apk` on the phone (allow installs from that source).

## Build locally

You need the Android SDK (platform 36) and JDK 17 or later.

```
cd android
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleDebug bundleRelease
```

## Publishing on Google Play (Jake to do)

1. **Account.** Google Play requires health apps, such as medical apps, to be published from an
   **organisation** account (Play Console Help, "Required information to create a Play Console developer
   account"). The EM Evidence account is currently Personal, so convert it to an organisation account in the
   company's name first (needs the company's D-U-N-S number).
2. **Upload key.** Make one and keep it outside the repository. One upload key can be used for all the EM
   Evidence apps:
   ```
   keytool -genkeypair -v -keystore em-evidence-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
3. **Repository secrets** (GitHub, Settings, Secrets and variables, Actions):
   `RESUS_KEYSTORE_BASE64` (the output of `base64 -w0 em-evidence-upload.jks`), `RESUS_KEYSTORE_PASSWORD`,
   `RESUS_KEY_ALIAS` (`upload`), `RESUS_KEY_PASSWORD`.
4. **Build.** Run the **Android app** action; the artifact holds the signed `app-release.aab`.
5. **Create the app in Play Console** and upload the bundle with Play App Signing (the default). Release to
   **Internal testing** first and check it on a phone and a tablet: a full adult arrest with the countdown
   (sound and speech), a paediatric and a newborn run, the record summary and Print.
6. **Each new release:** raise `resusVersionCode` and `resusVersionName` in `gradle.properties`.

Package name: `org.emevidence.resusassist`. Once published on Play it cannot change.

## Play Console answers

Prepared from what the app does (checked 25 October 2026). Jake must confirm them before submitting, because
the developer is responsible for their accuracy.

- **Privacy policy:** https://www.emevidence.org/privacy.html (the "Our apps" section covers this app).
- **Data safety:** no data collected and no data shared. The app has no account, analytics or advertising and
  makes no network requests; the current record is kept only in the app's own storage on the phone and is
  cleared by New Patient or after 12 hours. Android backup is turned off for the app.
- **Permissions:** none.
- **App access:** all functionality is available without special access.
- **Ads:** none. **Target audience:** 18 and over (healthcare professionals).
- **Health apps declaration:** Medical. Choose the categories that match how it is presented: it prompts and
  records a resuscitation attempt against the RCUK 2025 algorithms. The store listing and the app should make
  clear it is an aid for trained staff and does not replace clinical judgement or local protocols.
  Whether software like this counts as a medical device under UK MHRA rules has not been checked; take advice
  before describing it as anything other than an educational or cognitive aid.
- **Target API level:** 36, as Google Play needs for new apps and updates from 31 August 2026.
- **16 KB page size:** not affected; the app has no native code of its own.
- **Play Integrity API:** not used. The app has no server and no paid or protected content, so there is
  nothing for an integrity verdict to protect.
