# Listing Kit — real-estate listing toolkit

**Multi-file, no build step** — plain `<script src>` modules loaded by
`index.html`. See `~/.claude/CLAUDE.md` for build conventions (vanilla,
mobile-first, verify at 380px).

Layout: `index.html` + `app.js` (main), `generator.js`, `ai.js`,
`importer.js`/`parser.js` (REIWA import), `flyer.js`, `reel.js`, `qr.js`,
`fairhousing.js`. PWA via `manifest.webmanifest`. `deploy.sh` ships it.

Sensitive: **BYOK** — users paste their own AI API key; Listing Kit must never
hardcode or log one. REIWA property-data import. Before shipping AI / import /
`innerHTML` changes: no hardcoded secrets, escape rendered data, run
`/security-review`.
