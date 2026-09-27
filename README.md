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
