/* Listing Kit — listing-link importer.
 *
 * Paste a listing URL and we fetch the page through public read proxies
 * (r.jina.ai for text, images.weserv.nl for photo bytes — both send CORS
 * headers), extract the listing photos + details, and hand them to the app.
 * Photo bytes are downloaded into the browser as local blobs, so canvas
 * exports stay un-tainted and nothing else leaves the device.
 *
 * Reality check, verified against live sites (June 2026):
 *  - reiwa.com.au       ✓ works — and we can recover the FULL photo gallery
 *                          (numbered files on their public image store)
 *  - agency websites    ✓ generally work (WordPress/AgentBox etc.)
 *  - realestate.com.au  ✗ blocks all fetch proxies (Kasada)
 *  - domain.com.au      ✗ blocks all fetch proxies (Akamai)
 * For blocked sites the app suggests the REIWA twin listing or manual paste.
 */
const Importer = (() => {
  'use strict';

  const fetchT = (url, ms = 18000, opts = {}) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
  };

  // ---------------- page text ----------------
  const fetchPage = async (url) => {
    // 1) jina reader → clean markdown incl. image links
    try {
      const r = await fetchT('https://r.jina.ai/' + url);
      if (r.ok) {
        const t = await r.text();
        const blockedWrap = /Warning: Target URL returned error (40[34]|5\d\d)/.test(t);
        if (!blockedWrap && t.length > 1200) return { kind: 'md', text: t };
      }
    } catch (e) {}
    // 2) allorigins → raw HTML (flaky infra, but a fine fallback)
    return fetchPageHTML(url);
  };

  // HTML-only fetch (used as fallback and as a second opinion when the
  // reader returns a thin pre-render shell with no photos)
  const fetchPageHTML = async (url) => {
    try {
      const r = await fetchT('https://api.allorigins.win/raw?url=' + encodeURIComponent(url));
      if (r.ok) {
        const t = await r.text();
        if (t.length > 1200 && /<\w+[\s>]/.test(t)) return { kind: 'html', text: t };
      }
    } catch (e) {}
    return null;
  };

  // ---------------- text cleaning for the parser ----------------
  const decodeEntities = (s) => s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));

  const cleanText = (kind, text) => {
    if (kind === 'html') {
      return decodeEntities(
        text
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
      );
    }
    // markdown from jina: surface the title as the first line, strip md syntax
    const lines = [];
    const title = text.match(/^Title:\s*(.+)$/m);
    if (title) lines.push(title[1].split('|')[0].trim());
    text.split('\n').forEach((l) => {
      l = l
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')        // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')      // links → text
        .replace(/^[#>*\-\s]+/, '')                   // md markers
        .replace(/^\d+\.\s+/, '')                     // list numbers
        .replace(/\*\*/g, '')
        .trim();
      if (!l || /^https?:\/\//.test(l)) return;
      lines.push(l);
    });
    return lines.join('\n');
  };

  // ---------------- structured data (JSON-LD) ----------------
  const jsonLD = (html) => {
    const out = {};
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.streetAddress && !out.address) out.address = String(o.streetAddress);
      if (o.addressLocality && !out.city) out.city = String(o.addressLocality);
      if (o.price && !out.price) out.price = parseInt(String(o.price).replace(/[^\d]/g, ''), 10) || undefined;
      if (o.numberOfBedrooms != null && !out.beds) out.beds = String(parseFloat(o.numberOfBedrooms) || '');
      if (o.numberOfBathroomsTotal != null && !out.baths) out.baths = String(parseFloat(o.numberOfBathroomsTotal) || '');
      if (o.floorSize && o.floorSize.value && !out.sqft) {
        out.sqft = parseInt(String(o.floorSize.value).replace(/[^\d]/g, ''), 10) || undefined;
        out.areaUnit = /FTK|sq\s?ft/i.test(String(o.floorSize.unitCode || o.floorSize.unitText || '')) ? 'sqft' : 'sqm';
      }
      if (o.yearBuilt && !out.year) out.year = String(o.yearBuilt);
      Object.values(o).forEach(walk);
    };
    while ((m = re.exec(html))) {
      try { walk(JSON.parse(m[1])); } catch (e) {}
    }
    return out;
  };

  // ---------------- image URL extraction ----------------
  const IMG_BLOCK = /logo|icon|sprite|avatar|favicon|placeholder|profile|agent|staff|team|badge|banner|btn|button|map|floor-?plan|\.svg|\.gif|captcha|pixel|tracking/i;
  const LIKELY_CDN = /imagecdn|reastatic|domainstatic|cloudfront|imgix|cloudinary|amazonaws|azureedge|blob\.core\.windows|wp-content\/uploads|media\./i;

  const extractImages = (kind, text) => {
    const urls = [];
    if (kind === 'md') {
      let m;
      const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
      while ((m = re.exec(text))) urls.push(m[1]);
    } else {
      let m;
      [
        /property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/gi,
        /content=["']([^"']+)["'][^>]*property=["']og:image["']/gi,
        /<img[^>]+(?:data-src|data-lazy-src|src)=["'](https?:[^"'\s]+)["']/gi,
        /["'](https?:\/\/[^"'\s]+\.(?:jpe?g|png|webp)(?:\?[^"'\s]*)?)["']/gi,
      ].forEach((re2) => { while ((m = re2.exec(text))) urls.push(decodeEntities(m[1])); });
    }
    const seen = new Set();
    const out = [];
    for (const u of urls) {
      if (!/^https?:/i.test(u) || IMG_BLOCK.test(u)) continue;
      const isImg = /\.(jpe?g|png|webp)(\?|$)/i.test(u);
      if (!isImg && !LIKELY_CDN.test(u)) continue;
      let key;
      try { const p = new URL(u); key = p.origin + p.pathname; } catch (e) { continue; }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u);
      if (out.length >= 14) break;
    }
    return out;
  };

  // ---------------- REIWA full-gallery recovery ----------------
  // imagecdn.reiwa.com.au/listing/91/5022391-01.jpg redirects to a public Azure
  // blob (…/imagefiles/large/91/5022391-01.jpg) with sequentially numbered
  // photos — so from ANY one photo URL we can recover the whole gallery.
  const reiwaRef = (u) => {
    const m = String(u).match(/imagecdn\.reiwa\.com\.au\/listing\/(\d+)\/(\d+)-\d+\.(jpe?g|png|webp)/i)
      || String(u).match(/reiwastorprimg\.blob\.core\.windows\.net\/imagefiles\/\w+\/(\d+)\/(\d+)-\d+\.(jpe?g|png|webp)/i);
    return m ? { dir: m[1], id: m[2], ext: m[3] } : null;
  };
  // …and from a reiwa listing URL alone: the blob folder is the listing id's
  // last two digits (verified on live listings), so no page images are needed
  const reiwaRefFromURL = (u) => {
    const m = String(u).match(/reiwa\.com\.au\/[a-z0-9-]+?-(\d{6,})\/?/i);
    return m ? { dir: m[1].slice(-2), id: m[1], ext: 'jpg' } : null;
  };
  const reiwaGalleryURLs = (ref, max = 12) => {
    const urls = [];
    for (let i = 1; i <= max; i++) {
      urls.push(`https://reiwastorprimg.blob.core.windows.net/imagefiles/large/${ref.dir}/${ref.id}-${String(i).padStart(2, '0')}.${ref.ext}`);
    }
    return urls;
  };

  // ---------------- photo bytes (CORS-safe local blobs) ----------------
  const weserv = (u) =>
    'https://images.weserv.nl/?url=' + encodeURIComponent(u.replace(/^https?:\/\//i, '')) + '&w=1600&q=82';

  const fetchImageBlob = async (u) => {
    // weserv first (resizes + always CORS-clean), then a direct CORS attempt
    try {
      const r = await fetchT(weserv(u), 20000);
      if (r.ok) {
        const b = await r.blob();
        if (b.type.startsWith('image/') && b.size > 5000) return b;
      }
    } catch (e) {}
    try {
      const r = await fetchT(u, 15000, { mode: 'cors' });
      if (r.ok) {
        const b = await r.blob();
        if (b.type.startsWith('image/') && b.size > 5000) return b;
      }
    } catch (e) {}
    return null;
  };

  // fetch many image URLs (bounded concurrency), preserving order
  const fetchImages = async (urls, onProgress, limit = 4) => {
    const results = new Array(urls.length).fill(null);
    let next = 0, done = 0;
    const worker = async () => {
      while (next < urls.length) {
        const i = next++;
        results[i] = await fetchImageBlob(urls[i]);
        done++;
        if (onProgress) onProgress(done, urls.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
    return results;
  };

  const isImageURL = (u) => /\.(jpe?g|png|webp)(\?.*)?$/i.test(String(u).trim()) || /imagecdn|reastatic|domainstatic/i.test(u);
  const isBlockedPortal = (u) => /realestate\.com\.au|domain\.com\.au/i.test(u);

  return { fetchPage, fetchPageHTML, cleanText, jsonLD, extractImages, reiwaRef, reiwaRefFromURL, reiwaGalleryURLs, fetchImages, fetchImageBlob, isImageURL, isBlockedPortal };
})();
