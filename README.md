# Listing Kit

**Paste a listing once → get the whole marketing kit.** MLS description, Instagram
caption, Facebook post, email blast, and flyer copy — in a consistent voice — plus
a built-in **fair-housing language check** on every output.

Built for real estate agents who spend 1–3 hours writing marketing for every new
listing and hate doing it. Listing Kit turns that into about 30 seconds.

## Why it matters

- **Used on every listing.** The time savings recur with each new property.
- **Zero access to internal systems.** No CRM, no MLS login — works on any device,
  offline. You can demo it in an interview using any public listing's details.
- **Compliance built in.** Phrases like *"safe neighborhood," "perfect for
  families," "walking distance,"* and *"great schools"* are flagged with the *why*
  and a safer rewrite — the kind of fair-housing liability brokers genuinely worry
  about.

## How it works

100% in the browser. No backend, no API key, nothing uploaded.

- `index.html` — the app
- `generator.js` — the copy engine (property-aware, tone-driven templates)
- `fairhousing.js` — the compliance scanner (rules + safer alternatives)
- `app.js` — UI wiring
- `sw.js` / `manifest.webmanifest` — installable PWA, works offline

## Run it locally

It's a static site — open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Deploy (GitHub Pages)

```bash
GITHUB_USER=builderezra GITHUB_TOKEN=ghp_xxx REPO=listing-kit bash deploy.sh
```

## Roadmap

- Optional **"Polish with AI"** button (bring-your-own key) for premium copy.
- Saved agent profile (name/brokerage/contact auto-filled).
- More tones and property-type-specific templates.
- Project #2: contract deadline tracker.

---

*The compliance check is decision support, not legal advice. Always defer to your
broker's compliance team.*
