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
  // Public proxies are individually unreliable (jina hangs under load,
  // allorigins has day-long outages, corsproxy is browser-origin-only), so we
  // RACE all of them and take the first response that validates. Verified
  // June 2026: corsproxy.io is the most reliable from a browser.
  const PROXIES = [
    { kind: 'html', to: 14000, make: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u), ok: (t) => t.length > 1500 && /<\w+[\s>]/.test(t) },
    { kind: 'md', to: 12000, make: (u) => 'https://r.jina.ai/' + u, ok: (t) => t.length > 1200 && !/Warning: Target URL returned error (40[34]|5\d\d)/.test(t) },
    { kind: 'html', to: 14000, make: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u), ok: (t) => t.length > 1200 && /<\w+[\s>]/.test(t) },
  ];

  const raceProxies = (url, list) =>
    Promise.any(list.map((p) =>
      fetchT(p.make(url), p.to).then(async (r) => {
        if (!r.ok) throw new Error('status');
        const t = await r.text();
        if (!p.ok(t)) throw new Error('invalid');
        return { kind: p.kind, text: t };
      })
    )).catch(() => null);

  const fetchPage = (url) => raceProxies(url, PROXIES);

  // HTML-only fetch (second opinion when a reader result is thin)
  const fetchPageHTML = (url) => raceProxies(url, PROXIES.filter((p) => p.kind === 'html'));

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
      if (o.numberOfBedrooms != null && !out.beds) { const n = parseFloat(o.numberOfBedrooms); if (Number.isFinite(n)) out.beds = String(n); }
      if (o.numberOfBathroomsTotal != null && !out.baths) { const n = parseFloat(o.numberOfBathroomsTotal); if (Number.isFinite(n)) out.baths = String(n); }
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

  // The slug also encodes the address: "1-35-filburn-street-scarborough-5022391"
  // → "1/35 Filburn Street", "Scarborough". The street-type word marks where
  // the street ends and the suburb begins. Lets a REIWA import fill address +
  // suburb + full gallery even when every text proxy is down.
  const STREET_TYPES = new Set(('street st road rd avenue ave av drive dr court ct close cl crescent cres place pl way lane ln parade pde ' +
    'terrace tce boulevard bvd blvd circuit cct approach app gate rise vista loop mews entrance ent gardens gdns green grove gr heights hts ' +
    'promenade prom quays outlook retreat dale elbow fairway ramble corner cnr square sq highway hwy view views cove bend brook chase circle ' +
    'cir crest dell edge gateway glade glen haven island key keys link mead meander nook parkway pass path pocket point quay ridge row run ' +
    'trail turn vale walk waters wynd').split(' '));
  const reiwaSlugInfo = (u) => {
    const m = String(u).match(/reiwa\.com\.au\/([a-z0-9-]+?)-(\d{6,})\/?/i);
    if (!m) return null;
    const words = m[1].toLowerCase().split('-');
    let split = -1;
    for (let i = words.length - 1; i >= 0; i--) if (STREET_TYPES.has(words[i])) { split = i; break; }
    const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
    const addrWords = split >= 0 ? words.slice(0, split + 1) : words;
    const suburb = split >= 0 ? words.slice(split + 1).map(cap).join(' ') : '';
    let i = 0;
    const nums = [];
    while (i < addrWords.length && /^\d+[a-z]?$/.test(addrWords[i])) { nums.push(addrWords[i]); i++; }
    const street = addrWords.slice(i).map(cap).join(' ');
    const numPart = nums.length >= 2 ? nums[0] + '/' + nums.slice(1).join(' ') : nums.join('');
    const address = ((numPart ? numPart + ' ' : '') + street).trim();
    if (!address) return null;
    return { address, city: suburb, found: suburb ? ['address (from link)', 'suburb (from link)'] : ['address (from link)'] };
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
    try {
      const r = await fetchT('https://corsproxy.io/?url=' + encodeURIComponent(u), 16000);
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

  return { fetchPage, fetchPageHTML, cleanText, jsonLD, extractImages, reiwaRef, reiwaRefFromURL, reiwaSlugInfo, reiwaGalleryURLs, fetchImages, fetchImageBlob, isImageURL, isBlockedPortal };
})();
