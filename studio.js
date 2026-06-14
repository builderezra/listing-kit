/* Listing Kit — Design Studio (v1).
 *
 * A from-scratch layer editor: pick a background photo (with its filters) or a
 * brand colour, then add/drag/style text, price, address, stats and badge
 * layers on top, and export a real PNG. Works with mouse and touch. 100%
 * client-side; the canvas is full-resolution internally and CSS-scaled to fit.
 *
 * v1 covers the editing core (layers, drag, style, export). Saving your own
 * reusable templates and resize handles come next — the layer model here is
 * built to grow into that.
 */
const Studio = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SIZES = { square: [1080, 1080], story: [1080, 1920], wide: [1200, 630] };
  const SANS = `-apple-system, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif`;
  const SERIF = `Georgia, 'Times New Roman', serif`;

  let ctx2d, cv, ctxData = null;     // ctxData = { photos, brand, fields }
  let sizeKey = 'square';
  let layers = [];
  let bg = { type: 'photo', photoIndex: 0 };
  let selId = null;
  let uid = 1;

  const W = () => SIZES[sizeKey][0];
  const H = () => SIZES[sizeKey][1];
  const onColor = (hex) => Visuals.onColor(hex);

  const resolveColor = (c) => {
    const b = ctxData.brand;
    if (c === 'primary') return b.primary;
    if (c === 'accent') return b.accent;
    if (c === 'white') return '#ffffff';
    if (c === 'dark') return '#1c2b30';
    return c || '#ffffff';
  };

  // ---- background ------------------------------------------------------------
  const drawBackground = () => {
    const w = W(), h = H();
    if (bg.type === 'photo' && ctxData.photos[bg.photoIndex] && ctxData.photos[bg.photoIndex].img) {
      const p = ctxData.photos[bg.photoIndex];
      const img = p.img;
      const s = Math.max(w / img.width, h / img.height);
      const dw = img.width * s, dh = img.height * s;
      const fy = { top: 0, center: 0.5, bottom: 1 }[p.focus || 'center'];
      ctx2d.save();
      if (p.fcss) { try { ctx2d.filter = p.fcss; } catch (e) {} }
      ctx2d.drawImage(img, (w - dw) / 2, (h - dh) * fy, dw, dh);
      ctx2d.restore();
    } else {
      const b = ctxData.brand;
      const g = ctx2d.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, Visuals.shade(b.primary, 18));
      g.addColorStop(1, Visuals.shade(b.primary, -28));
      ctx2d.fillStyle = g; ctx2d.fillRect(0, 0, w, h);
    }
  };

  // ---- layers ----------------------------------------------------------------
  const measure = (L) => {
    const w = W();
    ctx2d.font = `${L.weight} ${L.size}px ${L.font === 'serif' ? SERIF : SANS}`;
    const lines = String(L.text).split('\n');
    let max = 0;
    lines.forEach((ln) => { max = Math.max(max, ctx2d.measureText(ln).width); });
    const lh = L.size * 1.25;
    const bw = max + (L.type === 'badge' ? L.size * 1.4 : 0);
    const bh = lines.length * lh + (L.type === 'badge' ? L.size * 0.6 : 0);
    return { lines, lh, bw, bh, textW: max };
  };

  const drawLayer = (L) => {
    const w = W(), h = H();
    const cx = L.xf * w, cy = L.yf * h;
    const m = measure(L);
    const col = resolveColor(L.color);
    ctx2d.textBaseline = 'top';
    ctx2d.textAlign = L.align;

    if (L.type === 'badge') {
      const bg2 = resolveColor(L.color);
      const padX = L.size * 0.7, padY = L.size * 0.3;
      const bx = cx - m.bw / 2, by = cy - m.bh / 2;
      ctx2d.fillStyle = bg2;
      roundRect(bx, by, m.bw, m.bh, m.bh / 2); ctx2d.fill();
      ctx2d.fillStyle = onColor(bg2);
      ctx2d.textAlign = 'center';
      ctx2d.fillText(String(L.text).split('\n')[0], cx, by + padY);
      L._box = { x: bx, y: by, w: m.bw, h: m.bh };
      return;
    }

    const startY = cy - m.bh / 2;
    const ax = L.align === 'left' ? cx - m.textW / 2 : L.align === 'right' ? cx + m.textW / 2 : cx;
    if (L.shadow) { ctx2d.shadowColor = 'rgba(0,0,0,.45)'; ctx2d.shadowBlur = L.size * 0.25; ctx2d.shadowOffsetY = 2; }
    ctx2d.fillStyle = col;
    m.lines.forEach((ln, i) => ctx2d.fillText(ln, ax, startY + i * m.lh));
    ctx2d.shadowColor = 'transparent'; ctx2d.shadowBlur = 0; ctx2d.shadowOffsetY = 0;
    L._box = { x: cx - m.textW / 2, y: startY, w: m.textW, h: m.bh };
  };

  const roundRect = (x, y, w, h, r) => {
    r = Math.min(r, w / 2, h / 2);
    ctx2d.beginPath();
    ctx2d.moveTo(x + r, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, r);
    ctx2d.arcTo(x + w, y + h, x, y + h, r);
    ctx2d.arcTo(x, y + h, x, y, r);
    ctx2d.arcTo(x, y, x + w, y, r);
    ctx2d.closePath();
  };

  const render = (showSel = true) => {
    cv.width = W(); cv.height = H();
    ctx2d.clearRect(0, 0, W(), H());
    drawBackground();
    layers.forEach(drawLayer);
    if (showSel && selId) {
      const L = layers.find((x) => x.id === selId);
      if (L && L._box) {
        ctx2d.strokeStyle = '#2c7a7b'; ctx2d.lineWidth = Math.max(2, W() / 360); ctx2d.setLineDash([W() / 90, W() / 120]);
        const pad = L.size * 0.25;
        ctx2d.strokeRect(L._box.x - pad, L._box.y - pad, L._box.w + pad * 2, L._box.h + pad * 2);
        ctx2d.setLineDash([]);
      }
    }
  };

  // ---- add layers ------------------------------------------------------------
  const add = (kind) => {
    const f = ctxData.fields;
    const base = { id: uid++, type: 'text', xf: 0.5, yf: 0.5, size: Math.round(W() * 0.06), color: 'white', font: 'sans', weight: 800, align: 'center', shadow: true };
    let L;
    if (kind === 'price') L = { ...base, text: f.price || '$0', size: Math.round(W() * 0.085), yf: 0.8 };
    else if (kind === 'address') L = { ...base, text: f.address || 'Address', weight: 400, size: Math.round(W() * 0.04), yf: 0.88 };
    else if (kind === 'stats') L = { ...base, text: f.stats || '0 BD · 0 BA', weight: 600, size: Math.round(W() * 0.032), yf: 0.93 };
    else if (kind === 'badge') L = { ...base, type: 'badge', text: f.badge || 'JUST LISTED', color: 'accent', size: Math.round(W() * 0.035), weight: 800, yf: 0.12, xf: 0.22 };
    else L = { ...base, text: 'Your text' };
    layers.push(L); selId = L.id; render(); syncPanel();
  };

  // ---- hit testing + drag ----------------------------------------------------
  let drag = null;
  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (W() / r.width), y: (t.clientY - r.top) * (H() / r.height) };
  };
  const hit = (x, y) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const b = layers[i]._box; if (!b) continue;
      const pad = layers[i].size * 0.4;
      if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return layers[i];
    }
    return null;
  };
  const onDown = (e) => {
    const p = pt(e); const L = hit(p.x, p.y);
    selId = L ? L.id : null;
    if (L) { drag = { id: L.id, dx: p.x - L.xf * W(), dy: p.y - L.yf * H() }; e.preventDefault(); }
    render(); syncPanel();
  };
  const onMove = (e) => {
    if (!drag) return;
    const p = pt(e); const L = layers.find((x) => x.id === drag.id); if (!L) return;
    L.xf = Math.min(1, Math.max(0, (p.x - drag.dx) / W()));
    L.yf = Math.min(1, Math.max(0, (p.y - drag.dy) / H()));
    render(); e.preventDefault();
  };
  const onUp = () => { drag = null; };

  // ---- side panel ------------------------------------------------------------
  const sel = () => layers.find((x) => x.id === selId);
  const COLORS = [['white', '#ffffff'], ['dark', '#1c2b30'], ['primary', null], ['accent', null]];
  const renderBgPicker = () => {
    const box = $('stBg'); box.innerHTML = '';
    ctxData.photos.forEach((p, i) => {
      const im = document.createElement('img');
      im.src = p.url; im.className = 'st-bg-thumb' + (bg.type === 'photo' && bg.photoIndex === i ? ' active' : '');
      im.style.filter = p.fcss || '';
      im.addEventListener('click', () => { bg = { type: 'photo', photoIndex: i }; renderBgPicker(); render(); });
      box.appendChild(im);
    });
    const col = document.createElement('button');
    col.className = 'st-bg-color' + (bg.type === 'color' ? ' active' : '');
    col.style.background = ctxData.brand.primary; col.title = 'Brand colour';
    col.addEventListener('click', () => { bg = { type: 'color' }; renderBgPicker(); render(); });
    box.appendChild(col);
  };
  const syncPanel = () => {
    const L = sel();
    $('stLayerCtl').hidden = !L;
    if (!L) return;
    $('stText').value = L.text;
    $('stSize').value = L.size;
    $('stFont').textContent = L.font === 'serif' ? 'Serif' : 'Sans';
    $('stFont').classList.toggle('on', L.font === 'serif');
    $('stBold').classList.toggle('on', L.weight >= 700);
    $('stShadow').classList.toggle('on', !!L.shadow);
    ['L', 'C', 'R'].forEach((a) => $('stAlign' + a).classList.toggle('on', L.align === { L: 'left', C: 'center', R: 'right' }[a]));
    const cbox = $('stColors'); cbox.innerHTML = '';
    COLORS.forEach(([key, hex]) => {
      const sw = document.createElement('button');
      sw.className = 'st-sw' + (L.color === key ? ' active' : '');
      sw.style.background = hex || resolveColor(key);
      sw.addEventListener('click', () => { L.color = key; render(); syncPanel(); });
      cbox.appendChild(sw);
    });
  };

  // ---- export ----------------------------------------------------------------
  const exportPNG = () => {
    render(false);
    const slug = (ctxData.fields.address || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    cv.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug}-${sizeKey}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
    render(true);
  };

  // ---- open / wire -----------------------------------------------------------
  let wired = false;
  const wire = () => {
    if (wired) return; wired = true;
    cv = $('stCanvas'); ctx2d = cv.getContext('2d');
    cv.addEventListener('mousedown', onDown); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    cv.addEventListener('touchstart', onDown, { passive: false }); cv.addEventListener('touchmove', onMove, { passive: false }); cv.addEventListener('touchend', onUp);
    document.querySelectorAll('#stSizes button').forEach((b) => b.addEventListener('click', () => {
      sizeKey = b.dataset.size;
      document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x === b));
      render();
    }));
    document.querySelectorAll('#stAdd button').forEach((b) => b.addEventListener('click', () => add(b.dataset.add)));
    $('stText').addEventListener('input', () => { const L = sel(); if (L) { L.text = $('stText').value; render(); } });
    $('stSize').addEventListener('input', () => { const L = sel(); if (L) { L.size = Number($('stSize').value); render(); } });
    $('stFont').addEventListener('click', () => { const L = sel(); if (L) { L.font = L.font === 'serif' ? 'sans' : 'serif'; render(); syncPanel(); } });
    $('stBold').addEventListener('click', () => { const L = sel(); if (L) { L.weight = L.weight >= 700 ? 400 : 800; render(); syncPanel(); } });
    $('stShadow').addEventListener('click', () => { const L = sel(); if (L) { L.shadow = !L.shadow; render(); syncPanel(); } });
    ['L', 'C', 'R'].forEach((a) => $('stAlign' + a).addEventListener('click', () => { const L = sel(); if (L) { L.align = { L: 'left', C: 'center', R: 'right' }[a]; render(); syncPanel(); } }));
    $('stDup').addEventListener('click', () => { const L = sel(); if (L) { const n = { ...L, id: uid++, xf: Math.min(0.95, L.xf + 0.04), yf: Math.min(0.95, L.yf + 0.04), _box: null }; layers.push(n); selId = n.id; render(); syncPanel(); } });
    $('stDel').addEventListener('click', () => { layers = layers.filter((x) => x.id !== selId); selId = null; render(); syncPanel(); });
    $('stExport').addEventListener('click', exportPNG);
    $('stClose').addEventListener('click', close);
  };

  const open = (data, startSize) => {
    wire();
    ctxData = data;
    sizeKey = startSize && SIZES[startSize] ? startSize : 'square';
    document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x.dataset.size === sizeKey));
    bg = ctxData.photos.length ? { type: 'photo', photoIndex: 0 } : { type: 'color' };
    layers = []; selId = null;
    // seed a few sensible starter layers from the listing
    const f = ctxData.fields;
    if (f.badge) add('badge');
    if (f.price) add('price');
    if (f.address) add('address');
    selId = null;
    renderBgPicker(); render(); syncPanel();
    $('studio').hidden = false;
    document.body.style.overflow = 'hidden';
  };
  const close = () => { $('studio').hidden = true; document.body.style.overflow = ''; };

  return { open, close };
})();
