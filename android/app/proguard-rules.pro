# The page calls these through the ResusAndroid JavaScript interface, so keep their names.
-keepclassmembers class org.emevidence.resusassist.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
