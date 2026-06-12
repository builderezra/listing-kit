/* Listing Kit — listing-text parser (v3).
 *
 * Site-agnostic: paste text copied from any listing portal — Zillow, Realtor,
 * Redfin, Trulia, Homes.com, Rightmove, Zoopla, OnTheMarket, Domain,
 * realestate.com.au, Realtor.ca, Property24, Daft.ie, TradeMe, an MLS sheet,
 * or a colleague's email — and it extracts what it can: price (with currency),
 * beds, baths, interior area (sq ft or m²), lot size, year built, property
 * type, and a best-guess address. Pure regex over text; nothing is fetched.
 */
const Parser = (() => {
  'use strict';

  // "1.250.000", "1,250,000", "1 250 000" -> 1250000 ; "1.2" + million -> 1200000
  const numVal = (raw, mult) => {
    const s = String(raw).trim();
    if (mult) {
      const f = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
      if (!isFinite(f)) return null;
      const v = Math.round(f * mult);
      // "£1.2m" is fine; "£1,250m" is a misparse — ignore the multiplier then.
      return f < 1000 ? v : Math.round(f);
    }
    const digits = s.replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : null;
  };

  // suffix multipliers — lookaheads keep "m²"/"kr" from reading as million/k
  const MULT = `(million(?![a-z])|m(?![²2a-z])|k(?![a-z²]))`;
  // grouped number: "475,000" / "2 950 000" / "1.250.000" / "1.2" — group-of-3
  // separators only, so digits never glom across line breaks or stat rows
  const NUM = `(\\d{1,3}(?:[ .,]\\d{3})*(?:[.,]\\d{1,2})?|\\d+)`;

  const CURRENCIES = [
    { re: new RegExp(`£\\s?${NUM}\\s*${MULT}?`, 'i'), c: '£' },
    { re: new RegExp(`€\\s?${NUM}\\s*${MULT}?`, 'i'), c: '€' },
    { re: new RegExp(`C\\$\\s?${NUM}`, 'i'), c: 'C$' },
    { re: new RegExp(`\\bCAD\\s?\\$?${NUM}`, 'i'), c: 'C$' },
    { re: new RegExp(`A\\$\\s?${NUM}`, 'i'), c: 'A$' },
    { re: new RegExp(`\\bAUD\\s?\\$?${NUM}`, 'i'), c: 'A$' },
    { re: new RegExp(`NZ\\$\\s?${NUM}`, 'i'), c: 'NZ$' },
    { re: new RegExp(`CHF\\s?${NUM}`, 'i'), c: 'CHF' },
    { re: new RegExp(`₹\\s?${NUM}`), c: '₹' },
    { re: new RegExp(`¥\\s?${NUM}`), c: '¥' },
    { re: new RegExp(`\\bR\\s?${NUM}`), c: 'R' },                   // ZAR "R 2 950 000"
    { re: new RegExp(`${NUM}\\s*kr\\b`, 'i'), c: 'kr' },
    { re: new RegExp(`\\$\\s?${NUM}\\s*${MULT}?`, 'i'), c: '$' },
  ];

  const TYPE_MAP = [
    { k: ['apartment', 'flat', 'penthouse', 'studio', 'unit '], t: 'apartment' },
    { k: ['condo'], t: 'condo' },
    { k: ['townhouse', 'townhome', 'terraced', 'row house', 'rowhouse'], t: 'townhouse' },
    { k: ['multi-family', 'multifamily', 'multi family', 'duplex', 'triplex', 'fourplex'], t: 'multi' },
    { k: ['vacant land', 'plot for sale', 'land for sale', 'section for sale', 'lot for sale'], t: 'land' },
    { k: ['estate', 'mansion', 'luxury'], t: 'luxury' },
    { k: ['villa'], t: 'villa' },
    { k: ['detached', 'semi-detached', 'bungalow', 'cottage', 'single-family', 'single family', 'house'], t: 'single' },
  ];

  const STREET_WORDS = /(road|street|avenue|boulevard|lane|drive|court|crescent|close|way|place|terrace|gardens|grove|park|row|mews|rise|hill|rd|st|ave|blvd|ln|dr|ct|cres|cl|pl|ter)\b/i;

  const parse = (input) => {
    const text = String(input || '').replace(/ /g, ' ');
    const out = {};
    const found = [];

    // ---- price + currency ---------------------------------------------------
    for (const { re, c } of CURRENCIES) {
      const m = text.match(re);
      if (m) {
        const multWord = (m[2] || '').toLowerCase();
        const mult = multWord.startsWith('m') ? 1e6 : multWord === 'k' ? 1e3 : 0;
        const v = numVal(m[1], mult);
        if (v && v >= 1000) {
          out.price = v;
          out.currency = c;
          found.push(`price (${c})`);
          break;
        }
      }
    }
    if (!out.price) {
      const m = text.match(/(?:price|asking|guide(?:\s+price)?|offers(?:\s+(?:over|around|in\s+excess\s+of))?|listed\s+(?:at|for))\D{0,10}([\d][\d\s.,]{3,})/i);
      if (m) { const v = numVal(m[1]); if (v && v >= 1000) { out.price = v; found.push('price'); } }
    }

    // ---- beds / baths / cars --------------------------------------------------
    // AU shorthand first: "4x2" or "4x2x2" = beds × baths (× cars)
    let m = text.match(/\b([1-9])\s*[x×]\s*([1-9](?:\.\d)?)(?:\s*[x×]\s*(\d{1,2}))?\b/i);
    if (m) {
      out.beds = m[1]; out.baths = m[2]; found.push('beds', 'baths');
      if (m[3]) { out.cars = m[3]; found.push('cars'); }
    }
    if (!out.beds) {
      m = text.match(/(\d+(?:\.\d)?)\s*(?:bed(?:room)?s?|bd|br)\b/i) || text.match(/bed(?:room)?s?\s*[:\-–]?\s*(\d+)/i);
      if (m) { out.beds = m[1]; found.push('beds'); }
    }
    if (!out.baths) {
      m = text.match(/(\d+(?:\.\d)?)\s*(?:bath(?:room)?s?|ba)\b/i) || text.match(/bath(?:room)?s?\s*[:\-–]?\s*(\d+)/i);
      if (m) { out.baths = m[1]; found.push('baths'); }
    }
    if (!out.cars) {
      m = text.match(/(\d+)\s*(?:car(?:\s*(?:bays?|spaces?|ports?))?|garage|parking)\b/i);
      if (m) { out.cars = m[1]; found.push('cars'); }
      else if (/\b(?:double|2)\s*(?:lock[- ]?up\s*)?garage\b/i.test(text)) { out.cars = '2'; found.push('cars'); }
      else if (/\bsingle\s*garage\b/i.test(text)) { out.cars = '1'; found.push('cars'); }
      else if (/\btriple\s*garage\b/i.test(text)) { out.cars = '3'; found.push('cars'); }
    }

    // ---- areas: metric listings often quote BOTH block and internal size -------
    // Collect every m² mention; ones flagged by block/land words (before or
    // after) are the lot. Of the rest: one value = internal size; several =
    // the smallest is internal (block > house in nearly every AU listing).
    const NUMRE = `(\\d{1,3}(?:[ .,]\\d{3})*|\\d+)`;
    const sqmRe = new RegExp(`(?:(block|land|plot|lot|section|erf|site)\\D{0,10})?${NUMRE}\\s*(?:m²|m2\\b|sqm\\b|sq\\.?\\s*m\\b|square\\s+met(?:er|re)s?)(?:\\s*(block|land|plot|lot|section|site))?`, 'gi');
    const sqms = [...text.matchAll(sqmRe)]
      .map((x) => ({ v: numVal(x[2]), isBlock: !!(x[1] || x[3]) }))
      .filter((x) => x.v && x.v > 10);
    const blocks = sqms.filter((x) => x.isBlock);
    let interiors = sqms.filter((x) => !x.isBlock).map((x) => x.v);
    if (blocks.length) { out.lot = blocks[0].v.toLocaleString('en-US') + ' m²'; found.push('block size'); }
    else if (interiors.length >= 2) {
      const max = Math.max(...interiors);
      out.lot = max.toLocaleString('en-US') + ' m²';
      interiors = interiors.filter((v) => v !== max);
      found.push('block size');
    }
    if (interiors.length) { out.sqft = Math.min(...interiors); out.areaUnit = 'sqm'; found.push('size (m²)'); }

    if (!out.sqft) {
      const ft = text.match(new RegExp(`${NUMRE}\\s*(?:sq\\.?\\s*ft|sqft|ft²|square\\s+f(?:ee|oo)t)`, 'i'));
      if (ft) { const v = numVal(ft[1]); if (v && v > 100) { out.sqft = v; out.areaUnit = 'sqft'; found.push('size (sq ft)'); } }
    }

    // ---- lot in imperial / named units ------------------------------------------
    if (!out.lot) {
      m = text.match(/([\d.,]+)\s*acres?\b/i);
      if (m) { out.lot = m[1] + '-acre'; found.push('lot'); }
      else if ((m = text.match(/([\d.,]+)\s*(?:hectares?|\bha\b)/i))) { out.lot = m[1] + '-hectare'; found.push('lot'); }
    }

    // ---- year built ------------------------------------------------------------
    m = text.match(/(?:year\s*built|built\s*in|built|constructed)\D{0,8}((?:18|19|20)\d{2})/i) || text.match(/((?:18|19|20)\d{2})\s*[-–]?\s*built/i);
    if (m) { out.year = m[1]; found.push('year built'); }

    // ---- property type ----------------------------------------------------------
    const low = ' ' + text.toLowerCase() + ' ';
    for (const { k, t } of TYPE_MAP) {
      if (k.some((kw) => low.includes(kw))) { out.type = t; found.push('type'); break; }
    }

    // ---- address (best guess) -----------------------------------------------------
    const NOT_ADDR = /\b(bed|bath|garage|car|sale|let|sold|auction|offers|guide|price|built|sqm|sq ft)\b/i;
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 5 && l.length < 90);
    // "24 Salvado Road" and AU unit format "5/120 Marine Parade"
    const STREET_NO = /^\d{1,4}[A-Za-z]?(?:\/\d{1,6}[A-Za-z]?)?\s+[A-Z]/;
    const addrLine =
      lines.find((l) => STREET_NO.test(l) && STREET_WORDS.test(l) && !NOT_ADDR.test(l)) ||
      lines.find((l) => STREET_NO.test(l) && /\s[A-Z][a-z]/.test(l) && !NOT_ADDR.test(l)) ||
      lines.find((l) => STREET_WORDS.test(l) && /^[A-Z\d]/.test(l) && !NOT_ADDR.test(l));
    if (addrLine) {
      const parts = addrLine.split(/[|•·]/)[0].split(',').map((s) => s.trim()).filter(Boolean);
      out.address = parts[0];
      if (parts[1] && /^[A-Za-z]/.test(parts[1])) {
        out.city = parts[1]
          .replace(/\b(WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\b\s*\d{4}\b/g, '')   // AU "Subiaco WA 6008"
          .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, '')          // UK postcode
          .replace(/\b\d{4,5}\b/g, '')                                    // bare postcode
          .trim();
      }
      found.push('address');
      if (out.city) found.push('city');
    }

    return { ...out, found };
  };

  return { parse };
})();
