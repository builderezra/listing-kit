# Listing Kit

**Photos + details in → the whole marketing kit out.** Branded Instagram posts,
stories, and Facebook graphics composited from the listing photos, a print-ready
8.5×11 flyer, plus MLS / Instagram / Facebook / email copy — all with a built-in
**fair-housing language check**.

Built for real estate agents who rebuild the same Canva templates for every new
listing. Listing Kit remembers your design once, then each new listing is just:
paste details, drop photos, download everything.

## What it generates

- **Social graphics** — Instagram post (1080×1080), Story/Reel cover (1080×1920),
  Facebook/link image (1200×630), composited from your photos in 3 design
  templates (Modern / Classic / Bold), exported as PNGs
- **Print flyer** — designed 8.5×11 with hero photo, photo strip, stats, feature
  highlights, agent block, and Equal Housing notice → print or save as PDF
- **Copy** — two-paragraph MLS description, Instagram caption with hashtags,
  Facebook post, and email blast, in 5 selectable tones
- **Compliance report** — flags fair-housing language risks (in your inputs *and*
  every output) with severity, the why, and a safer rewrite

## The brand kit (set once, remembered)

Name, brokerage, contact info, brand + accent colors, logo, headshot, and your
chosen design template are saved on-device (localStorage). Every future listing
inherits the same look — that's the "remembered design pattern."

Status badges (Just Listed / Open House / New Price / Just Sold) carry the same
design through the whole listing lifecycle.

## How it works

100% in the browser. No backend, no API key. Photos never leave your device.

- `index.html` — the app
- `generator.js` — copy engine (categorized features → prose, tone-driven)
- `visuals.js` — canvas renderer for the social graphics (3 templates × 3 sizes)
- `flyer.js` — print-ready flyer builder (HTML → print/PDF)
- `fairhousing.js` — compliance scanner (rules + safer alternatives)
- `app.js` — UI wiring, brand-kit persistence, photo management
- `sw.js` / `manifest.webmanifest` — installable PWA, works offline

## Run it locally

```bash
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Deploy (GitHub Pages)

```bash
GITHUB_USER=builderezra GITHUB_TOKEN=ghp_xxx REPO=listing-kit bash deploy.sh
```

## Roadmap

- Optional **"Polish with AI"** (bring-your-own key) for bespoke copy
- Carousel builder: one branded slide per photo
- Open-house sign-in sheet + QR code generator
- Project #2: contract deadline tracker

---

*The compliance check is decision support, not legal advice. Always defer to your
broker's compliance team.*
