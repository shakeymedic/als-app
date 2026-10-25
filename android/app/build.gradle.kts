// Resuscitation Assist as an Android app. The web app (../index.html, ../vendor, ../icons) is bundled
// inside the app and shown in a WebView, so it works with no signal from the first launch, like the
// HALO QRH app. Build with ./gradlew bundleRelease (see android/README.md).
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val webRoot = rootProject.file("..")

android {
    namespace = "org.emevidence.resusassist"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.emevidence.resusassist"
        minSdk = 26
        targetSdk = 36
        versionCode = (findProperty("resusVersionCode") as String).toInt()
        versionName = findProperty("resusVersionName") as String
    }

    signingConfigs {
        // Release signing comes from environment variables (GitHub Actions secrets), never from the repository.
        create("release") {
            val ks = System.getenv("RESUS_KEYSTORE_FILE")
            if (ks != null) {
                storeFile = file(ks)
                storePassword = System.getenv("RESUS_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("RESUS_KEY_ALIAS")
                keyPassword = System.getenv("RESUS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (System.getenv("RESUS_KEYSTORE_FILE") != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/siteAssets"))

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

// Copies the web app into the app's assets. In index.html it swaps the hotlinked logo for a bundled
// copy, drops the service worker (the files are already on the phone) and loads android-bridge.js,
// which gives the page spoken prompts and printing through Android (WebView has neither).
val copySite by tasks.registering(Sync::class) {
    from(webRoot) {
        include("index.html", "vendor/**", "icons/**")
        filesMatching("index.html") {
            filter { line: String ->
                line.replace("https://raw.githubusercontent.com/shakeymedic/wmem/main/emevidence_logo.png", "android/emevidence_logo.png")
                    .replace("<script src=\"sw-register.js\"></script>", "")
                    .replace("<script src=\"vendor/icons.js\"></script>",
                        "<script src=\"android/android-bridge.js\"></script>\n    <script src=\"vendor/icons.js\"></script>")
            }
        }
    }
    from(file("src/web")) { into("android") }
    into(layout.buildDirectory.dir("generated/siteAssets/site"))
    doLast {
        val html = destinationDir.resolve("index.html").readText()
        check("android/android-bridge.js" in html) { "index.html no longer loads vendor/icons.js the expected way: update copySite in android/app/build.gradle.kts" }
        check("raw.githubusercontent.com" !in html) { "index.html still hotlinks the logo: update copySite in android/app/build.gradle.kts" }
        check("sw-register.js" !in html) { "index.html still registers the service worker: update copySite in android/app/build.gradle.kts" }
    }
}
tasks.named("preBuild") { dependsOn(copySite) }

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")
}
