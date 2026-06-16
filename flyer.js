/* Listing Kit — print-ready flyer builder (v2).
 *
 * Builds a designed 8.5×11 flyer as a self-contained HTML document: hero photo,
 * photo strip, listing stats, description, feature list, and the agent's brand
 * kit (colors, logo, headshot, contact). Rendered into an iframe for live
 * preview and opened in a new window for Print → Save as PDF, which gives
 * crisp vector text at any size.
 */
const Flyer = (() => {
  'use strict';

  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // page geometry: A4 everywhere except the US (Letter). px @ 96dpi for preview scaling.
  const pagePx = (brand) => (brand.region === 'us' ? { w: 816, h: 1056 } : { w: 794, h: 1123 });

  const buildHTML = ({ d, brand, photos, mls, features, print, showHead }) => {
    const isA4 = brand.region !== 'us';
    const pageSize = isA4 ? 'A4' : 'letter';
    const pageW = isA4 ? '210mm' : '8.5in';
    const pageH = isA4 ? '297mm' : '11in';
    const primary = brand.primary || '#0f2e3d';
    const accent = brand.accent || '#c08a3e';
    const onPrim = Visuals.onColor(primary);
    const hero = photos[0] ? photos[0].url : '';
    const heroFilter = photos[0] && photos[0].fcss ? photos[0].fcss : '';
    const strip = photos.slice(1, 4);

    const rent = d.mode === 'rent';
    const stats = (rent ? [
      d.beds && [d.beds, d.beds == 1 ? 'Bedroom' : 'Bedrooms'],
      d.baths && [d.baths, d.baths == 1 ? 'Bath' : 'Baths'],
      d.cars && [d.cars, d.cars == 1 ? 'Car' : 'Cars'],
      d.sqft && [d.sqft, d.areaUnit === 'sqm' ? 'm²' : 'Sq Ft'],
      d.available && [d.available, 'Available'],
      d.leaseTerm && [d.leaseTerm, 'Lease'],
      d.furnished === 'furnished' && ['Yes', 'Furnished'],
    ] : [
      d.beds && [d.beds, d.beds == 1 ? 'Bedroom' : 'Bedrooms'],
      d.baths && [d.baths, d.baths == 1 ? 'Bath' : 'Baths'],
      d.cars && [d.cars, d.cars == 1 ? 'Car' : 'Cars'],
      d.sqft && [d.sqft, d.areaUnit === 'sqm' ? 'm²' : 'Sq Ft'],
      d.lot && [d.lot, 'Lot'],
      d.year && [d.year, 'Built'],
    ]).filter(Boolean);
    const headlineFont = brand.font === 'sans'
      ? `-apple-system, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif`
      : `Georgia, 'Times New Roman', serif`;

    const mlsParas = String(mls || '').split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Flyer — ${esc(d.address || 'Listing')}</title>
<style>
  @page { size: ${pageSize}; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  html, body { background: #777; }
  body { font-family: -apple-system, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif; color: #22313a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: ${pageW}; height: ${pageH}; margin: 0 auto; background: #fff; display: flex; flex-direction: column; overflow: hidden; position: relative; }
  @media print { html, body { background: #fff; } .printbar { display: none !important; } }

  .topbar { background: ${primary}; color: ${onPrim}; display: flex; align-items: center; justify-content: space-between; padding: 0.16in 0.45in; }
  .topbar .status { font-size: 15pt; font-weight: 800; letter-spacing: 3px; }
  .topbar .oh { font-size: 10pt; opacity: .9; font-weight: 600; }
  .topbar .brok { font-size: 10pt; opacity: .85; letter-spacing: 1px; text-transform: uppercase; }

  .hero { height: 4.1in; background: ${primary}; position: relative; }
  .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hero .noimg { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 60pt; background: linear-gradient(135deg, ${Visuals.shade(primary, 30)}, ${Visuals.shade(primary, -20)}); }
  .pricetag { position: absolute; right: 0; bottom: 0.32in; background: ${accent}; color: ${Visuals.onColor(accent)}; font-size: 19pt; font-weight: 800; padding: 0.1in 0.42in 0.1in 0.3in; }

  .addr { padding: 0.22in 0.45in 0.05in; display: flex; align-items: baseline; justify-content: space-between; }
  .addr h1 { font-family: ${headlineFont}; font-size: 19pt; color: ${primary}; font-weight: 700; }
  .addr .city { font-size: 11pt; color: #5d6e75; }

  .stats { display: flex; gap: 0.32in; padding: 0.1in 0.45in 0.14in; border-bottom: 2px solid ${accent}; margin: 0 0.45in 0.16in; padding-left: 0; padding-right: 0; }
  .stat b { display: block; font-size: 13.5pt; color: ${primary}; }
  .stat span { font-size: 8pt; text-transform: uppercase; letter-spacing: 1.2px; color: #768489; }

  .cols { display: flex; gap: 0.32in; padding: 0 0.45in; flex: 1; min-height: 0; }
  .desc { flex: 1.45; font-size: 9.6pt; line-height: 1.52; color: #34444c; }
  .desc p + p { margin-top: 0.09in; }
  .side { flex: 1; }
  .side h3 { font-size: 9pt; letter-spacing: 2px; text-transform: uppercase; color: ${primary}; border-bottom: 1px solid ${accent}; padding-bottom: 4px; margin-bottom: 7px; }
  .side ul { list-style: none; }
  .side li { font-size: 9.4pt; padding: 2.5px 0 2.5px 14px; position: relative; }
  .side li::before { content: ''; position: absolute; left: 0; top: 9px; width: 6px; height: 6px; background: ${accent}; }

  .strip { display: flex; gap: 0.12in; padding: 0.14in 0.45in; }
  .strip img, .strip .ph { flex: 1; height: 1.42in; object-fit: cover; display: block; background: linear-gradient(135deg, ${Visuals.shade(primary, 30)}, ${Visuals.shade(primary, -20)}); }
  .strip .ph { display: flex; align-items: center; justify-content: center; font-size: 22pt; }

  .agent { background: ${primary}; color: ${onPrim}; display: flex; align-items: center; gap: 0.22in; padding: 0.18in 0.45in; margin-top: auto; }
  .agent .head { width: 0.85in; height: 0.85in; border-radius: 50%; object-fit: cover; border: 2.5px solid ${accent}; }
  .agent .who { flex: 1; }
  .agent .who b { font-size: 13pt; display: block; }
  .agent .who span { font-size: 9.5pt; opacity: .85; }
  .agent .contact { text-align: right; font-size: 9.5pt; line-height: 1.6; opacity: .95; }
  .agent img.logo { max-height: 0.55in; max-width: 1.6in; }
  .eho { background: ${Visuals.shade(primary, -28)}; color: ${onPrim}; opacity: .95; font-size: 6.6pt; letter-spacing: 1.5px; text-transform: uppercase; text-align: center; padding: 4px; }

  .printbar { position: fixed; top: 14px; right: 14px; z-index: 9; }
  .printbar button { font: 700 14px -apple-system, sans-serif; background: ${accent}; color: ${Visuals.onColor(accent)}; border: 0; border-radius: 8px; padding: 11px 20px; cursor: pointer; box-shadow: 0 3px 14px rgba(0,0,0,.35); }
</style></head><body>
${print ? '<div class="printbar"><button onclick="window.print()">🖨️ Print / Save as PDF</button></div>' : ''}
<div class="page">
  <div class="topbar">
    <span class="status">${esc(d.badgeText || 'JUST LISTED')}</span>
    ${d.ohLine ? `<span class="oh">${esc(d.ohLine)}</span>` : ''}
    <span class="brok">${esc(brand.brokerage || '')}</span>
  </div>
  <div class="hero">
    ${hero ? `<img src="${hero}" alt="" style="filter:${heroFilter}">` : '<div class="noimg">🏡</div>'}
    ${d.price ? `<div class="pricetag">${esc(d.price)}</div>` : ''}
  </div>
  <div class="addr">
    <h1>${esc(d.address || 'Beautiful Listing')}</h1>
    <span class="city">${esc(d.city || '')}</span>
  </div>
  ${stats.length ? `<div class="stats">${stats.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>` : ''}
  <div class="cols">
    <div class="desc">${mlsParas}</div>
    ${features.length ? `<div class="side"><h3>Highlights</h3><ul>${features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>` : ''}
  </div>
  ${strip.length ? `<div class="strip">${strip.map((p) => `<img src="${p.url}" alt="" style="filter:${p.fcss || ''}">`).join('')}${strip.length < 3 ? '<div class="ph">🏡</div>'.repeat(3 - strip.length) : ''}</div>` : ''}
  <div class="agent">
    ${(brand.headshot && showHead !== false) ? `<img class="head" src="${brand.headshot}" alt="">` : ''}
    <div class="who">
      <b>${esc(brand.agentName || 'Your Name Here')}</b>
      <span>${esc(brand.brokerage || '')}</span>
    </div>
    <div class="contact">${[brand.phone, brand.email].filter(Boolean).map(esc).join('<br>')}</div>
    ${brand.logo ? `<img class="logo" src="${brand.logo}" alt="">` : ''}
  </div>
  ${brand.region === 'us' ? '<div class="eho">⌂ Equal Housing Opportunity</div>' : ''}
</div>
</body></html>`;
  };

  const openPrint = (opts) => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(buildHTML({ ...opts, print: true }));
    w.document.close();
  };

  return { buildHTML, openPrint, pagePx };
})();
