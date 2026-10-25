# Resuscitation Assist (RCUK ALS / PLS / NLS)

Static web app to prompt and record in-hospital resuscitation.

- `index.html` – the app (source of truth). Loads its CSS/icons from `vendor/` – no CDNs, works offline.
- `als-standalone.html` – generated single-file version (everything inlined), e.g. for SharePoint. **Do not edit by hand.**

## Making changes

```sh
npm install
npm run build   # compiles Tailwind, bundles icons, regenerates als-standalone.html
npm test        # browser tests of the arrest flows, run offline against both files (needs Playwright)
```

Always run `npm run build` after editing `index.html` and commit the regenerated `vendor/` files and `als-standalone.html`.

## Data on the device

The current record is autosaved to the browser's local storage (so a reload or closed tab does not lose it) and is
cleared by **New Patient**. Saved records expire after 12 hours. No patient identifiers are requested by the app.

## Countdown to each rhythm / pulse check

15 s before the end of each 2-minute cycle the screen gets an amber frame and a spoken "Rhythm and pulse check in
15 seconds" prompt; in the last 10 s the whole screen flashes red once a second with a beep each second and a spoken
10, 5, 4, 3, 2, 1, then "Pause compressions. Check rhythm now." (NLS: a 5 s countdown to each heart-rate check.)
Speech uses the browser's built-in voices, so it works offline. Browsers only allow sound after someone has tapped the
page, so if a record is restored after a reload the timer card shows **Tap here to turn sound on**. The
**Countdown sound** button turns the sound off (the flash stays) and is remembered on the device.


## Android app

`android/` builds the Play Store app, which bundles `index.html` and its files so it works offline from the first
launch, with spoken prompts and printing through Android. See [android/README.md](android/README.md).
