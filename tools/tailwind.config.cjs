/** Tailwind is compiled at build time (no CDN) — see tools/build.mjs */
module.exports = {
  content: { relative: true, files: ['../index.html'] },
  theme: { extend: {} },
  plugins: [],
};
