/* Listing Kit — Design Studio (v2).
 *
 * A from-scratch canvas layer editor for real-estate marketing graphics.
 * Pick a background photo (with its filters) or a brand colour, then add,
 * drag, rotate, restyle and stack text / price / address / stats / badge /
 * shape / logo / headshot layers on top, and export a real, full-resolution
 * PNG or JPG. 100% client-side, mouse + touch.
 *
 * v2 turns the v1 editing core into something that feels like real software:
 *   • Undo / redo (snapshot history) + keyboard shortcuts + a ? cheat-sheet
 *   • A Layers panel — reorder (front/back), lock, hide, select
 *   • Full colour picker (brand swatches + any hex + recent colours) + opacity
 *   • Rotation, text outline, wrapping, gradient bars / legibility scrims
 *   • Ellipse + bar shapes, inline double-click text editing, snapping guides
 *   • Real-estate one-click pieces: status stamp (SOLD / UNDER OFFER / LEASED),
 *     home-open chip, agent contact block, disclaimer line
 *   • Starter template gallery + save-your-own reusable templates
 *   • Autosave of work-in-progress (restore on reopen) + close/leave guards
 *
 * The canvas backing store is always the true export resolution (e.g.
 * 1080×1080) and CSS-scaled to fit, so what you see is what you export — no
 * soft upscaling. Everything draws through one render()/drawLayer() path, so
 * the export is pixel-identical to the preview minus the editing chrome.
 */
const Studio = (() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SIZES = {
    square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920], wide: [1200, 630],
  };
  const SANS = `-apple-system, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif`;
  const SERIF = `Georgia, 'Times New Roman', serif`;
  const COARSE = (() => { try { return matchMedia('(pointer:coarse)').matches; } catch (e) { return false; } })();

  let ctx2d, cv, ctxData = null;     // ctxData = { photos, brand, fields }
  let sizeKey = 'square';
  let layers = [];
  let bg = { type: 'photo', photoIndex: 0 };
  let selId = null;
  let uid = 1;
  let guides = [];                   // transient snapping guides drawn while dragging
  let dirty = false;

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
  // hex (#rrggbb) + 0–1 alpha → rgba()
  const rgba = (hex, a) => {
    const h = (resolveColor(hex) || '#000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
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
      ctx2d.filter = 'none';
    } else {
      const b = ctxData.brand;
      const g = ctx2d.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, Visuals.shade(b.primary, 18));
      g.addColorStop(1, Visuals.shade(b.primary, -28));
      ctx2d.fillStyle = g; ctx2d.fillRect(0, 0, w, h);
    }
  };

  // ---- text measuring (with optional word-wrap) ------------------------------
  const fontStr = (L) => `${L.weight || 400} ${L.size}px ${L.font === 'serif' ? SERIF : SANS}`;
  const wrapLines = (text, maxW) => {
    const out = [];
    String(text).split('\n').forEach((para) => {
      if (!maxW) { out.push(para); return; }
      const words = para.split(/\s+/);
      let line = '';
      words.forEach((wd) => {
        const t = line ? line + ' ' + wd : wd;
        if (ctx2d.measureText(t).width > maxW && line) { out.push(line); line = wd; }
        else line = t;
      });
      out.push(line);
    });
    return out;
  };
  const measure = (L) => {
    ctx2d.font = fontStr(L);
    const maxW = L.wrapf ? L.wrapf * W() : 0;
    const lines = wrapLines(L.text, maxW);
    let textW = 0;
    lines.forEach((ln) => { textW = Math.max(textW, ctx2d.measureText(ln).width); });
    const lh = L.size * 1.25;
    const bw = textW + (L.type === 'badge' ? L.size * 1.4 : 0);
    const bh = lines.length * lh + (L.type === 'badge' ? L.size * 0.6 : 0);
    return { lines, lh, bw, bh, textW };
  };

  const roundRect = (x, y, w, h, r) => {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx2d.beginPath();
    ctx2d.moveTo(x + r, y);
    ctx2d.arcTo(x + w, y, x + w, y + h, r);
    ctx2d.arcTo(x + w, y + h, x, y + h, r);
    ctx2d.arcTo(x, y + h, x, y, r);
    ctx2d.arcTo(x, y, x + w, y, r);
    ctx2d.closePath();
  };

  // ---- one layer (drawn centred at the origin, then rotated/translated) ------
  const drawLayer = (L) => {
    if (L.hidden) { L._c = null; return; }
    const w = W(), h = H();
    const cx = L.xf * w, cy = L.yf * h;
    const rot = (L.rot || 0) * Math.PI / 180;
    ctx2d.save();
    ctx2d.translate(cx, cy);
    if (rot) ctx2d.rotate(rot);
    ctx2d.globalAlpha = L.opacity == null ? 1 : L.opacity;

    let bw = 0, bh = 0, pad = 0;

    if (L.type === 'rect') {
      bw = L.wf * w; bh = L.hf * h;
      const x = -bw / 2, y = -bh / 2;
      let fill = resolveColor(L.color);
      if (L.grad && L.grad !== 'none') {
        const dir = { up: [0, bh / 2, 0, -bh / 2], down: [0, -bh / 2, 0, bh / 2], left: [bw / 2, 0, -bw / 2, 0], right: [-bw / 2, 0, bw / 2, 0] }[L.grad];
        const g = ctx2d.createLinearGradient(dir[0], dir[1], dir[2], dir[3]);
        g.addColorStop(0, rgba(L.color, 1)); g.addColorStop(1, rgba(L.color, 0));
        fill = g;
      }
      ctx2d.fillStyle = fill;
      if (L.shape === 'ellipse') { ctx2d.beginPath(); ctx2d.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2); ctx2d.fill(); }
      else if (L.radius) { roundRect(x, y, bw, bh, L.radius); ctx2d.fill(); }
      else ctx2d.fillRect(x, y, bw, bh);
      if (L.stroke) { ctx2d.lineWidth = Math.max(1, L.strokeWf * w); ctx2d.strokeStyle = resolveColor(L.stroke); if (L.shape === 'ellipse') ctx2d.stroke(); else { roundRect(x, y, bw, bh, L.radius || 0); ctx2d.stroke(); } }
    } else if (L.type === 'image') {
      const img = L.src === 'logo' ? ctxData.brand.logoImg : ctxData.brand.headImg;
      if (!img || !img.width) { ctx2d.restore(); L._c = { cx, cy, w: 0, h: 0, rot: L.rot || 0, pad: 0 }; return; }
      const dw = L.wf * w;
      if (L.shape === 'circle') {
        const d = dw, s = Math.max(d / img.width, d / img.height);
        ctx2d.save(); ctx2d.beginPath(); ctx2d.arc(0, 0, d / 2, 0, Math.PI * 2); ctx2d.clip();
        ctx2d.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s);
        ctx2d.restore();
        bw = d; bh = d;
      } else {
        const dh = dw * (img.height / img.width);
        ctx2d.drawImage(img, -dw / 2, -dh / 2, dw, dh);
        bw = dw; bh = dh;
      }
    } else {
      // text + badge
      const m = measure(L);
      ctx2d.textBaseline = 'top';
      if (L.type === 'badge') {
        bw = m.bw; bh = m.bh;
        ctx2d.fillStyle = resolveColor(L.color);
        roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2); ctx2d.fill();
        ctx2d.fillStyle = onColor(resolveColor(L.color));
        ctx2d.textAlign = 'center';
        const padY = L.size * 0.3, startY = -bh / 2 + padY;
        m.lines.forEach((ln, i) => ctx2d.fillText(ln, 0, startY + i * m.lh));
      } else {
        bw = m.textW; bh = m.bh; pad = L.size * 0.25;
        const fill = resolveColor(L.color);
        ctx2d.textAlign = L.align;
        const ax = L.align === 'left' ? -m.textW / 2 : L.align === 'right' ? m.textW / 2 : 0;
        const startY = -bh / 2;
        if (L.shadow) { ctx2d.shadowColor = 'rgba(0,0,0,.45)'; ctx2d.shadowBlur = L.size * 0.25; ctx2d.shadowOffsetY = 2; }
        if (L.outline) {
          ctx2d.lineWidth = L.size * 0.1; ctx2d.lineJoin = 'round';
          ctx2d.strokeStyle = L.stroke ? resolveColor(L.stroke) : onColor(fill);
          m.lines.forEach((ln, i) => ctx2d.strokeText(ln, ax, startY + i * m.lh));
        }
        ctx2d.fillStyle = fill;
        m.lines.forEach((ln, i) => ctx2d.fillText(ln, ax, startY + i * m.lh));
        ctx2d.shadowColor = 'transparent'; ctx2d.shadowBlur = 0; ctx2d.shadowOffsetY = 0;
      }
    }

    ctx2d.restore();
    L._c = { cx, cy, w: bw, h: bh, rot: L.rot || 0, pad };
  };

  // corners of a layer's box in canvas space (for selection + hit testing)
  const boxCorners = (c) => {
    const hw = c.w / 2 + c.pad, hh = c.h / 2 + c.pad;
    const a = c.rot * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: c.cx + x * cos - y * sin, y: c.cy + x * sin + y * cos }));
  };
  const handleR = () => W() * (COARSE ? 0.03 : 0.018);

  const render = (showSel = true) => {
    cv.width = W(); cv.height = H();
    ctx2d.clearRect(0, 0, W(), H());
    drawBackground();
    layers.forEach(drawLayer);

    // empty-state hint
    if (!layers.length) {
      ctx2d.save();
      ctx2d.globalAlpha = 0.85; ctx2d.fillStyle = 'rgba(255,255,255,.9)';
      ctx2d.font = `600 ${Math.round(W() * 0.035)}px ${SANS}`;
      ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
      ctx2d.shadowColor = 'rgba(0,0,0,.5)'; ctx2d.shadowBlur = W() * 0.02;
      ctx2d.fillText('Add a layer to get started →', W() / 2, H() / 2);
      ctx2d.restore();
    }

    // snapping guides
    if (showSel && guides.length) {
      ctx2d.save();
      ctx2d.strokeStyle = '#e0498b'; ctx2d.lineWidth = Math.max(1.5, W() / 540); ctx2d.setLineDash([W() / 70, W() / 90]);
      guides.forEach((g) => { ctx2d.beginPath(); if (g.x != null) { ctx2d.moveTo(g.x, 0); ctx2d.lineTo(g.x, H()); } else { ctx2d.moveTo(0, g.y); ctx2d.lineTo(W(), g.y); } ctx2d.stroke(); });
      ctx2d.restore();
    }

    if (showSel && selId) {
      const L = layers.find((x) => x.id === selId);
      if (L && L._c) {
        const pts = boxCorners(L._c);
        ctx2d.save();
        ctx2d.strokeStyle = '#2c7a7b'; ctx2d.lineWidth = Math.max(2, W() / 360); ctx2d.setLineDash([W() / 90, W() / 120]);
        ctx2d.beginPath(); pts.forEach((p, i) => i ? ctx2d.lineTo(p.x, p.y) : ctx2d.moveTo(p.x, p.y)); ctx2d.closePath(); ctx2d.stroke();
        ctx2d.setLineDash([]);
        if (!L.locked) {
          ctx2d.fillStyle = '#2c7a7b'; ctx2d.beginPath(); ctx2d.arc(pts[2].x, pts[2].y, handleR(), 0, Math.PI * 2); ctx2d.fill();
          ctx2d.strokeStyle = '#fff'; ctx2d.lineWidth = Math.max(1.5, W() / 540); ctx2d.stroke();
        }
        ctx2d.restore();
      }
    }
  };

  // ---- add layers ------------------------------------------------------------
  const presets = () => {
    const f = ctxData.fields, w = W();
    const base = { id: 0, type: 'text', xf: 0.5, yf: 0.5, size: Math.round(w * 0.06), color: 'white', font: 'sans', weight: 800, align: 'center', shadow: true, opacity: 1, rot: 0 };
    const b = ctxData.brand;
    return {
      text: { ...base, text: 'Your text' },
      price: { ...base, field: 'price', text: f.price || '$0', size: Math.round(w * 0.085), yf: 0.8 },
      address: { ...base, field: 'address', text: f.address || 'Address', weight: 400, size: Math.round(w * 0.04), yf: 0.88 },
      stats: { ...base, field: 'stats', text: f.stats || '0 BD · 0 BA', weight: 600, size: Math.round(w * 0.032), yf: 0.93 },
      badge: { ...base, type: 'badge', field: 'badge', text: f.badge || 'JUST LISTED', color: 'accent', size: Math.round(w * 0.035), weight: 800, yf: 0.12, xf: 0.24 },
      status: { ...base, type: 'badge', text: 'SOLD', color: '#c0392b', size: Math.round(w * 0.055), weight: 800, yf: 0.2, xf: 0.5, rot: -10 },
      homeopen: { ...base, type: 'badge', text: 'HOME OPEN · SAT 11:00', color: 'primary', size: Math.round(w * 0.03), weight: 700, yf: 0.88, xf: 0.5 },
      agent: { ...base, text: [b.agentName, b.phone, b.brokerage].filter(Boolean).join('\n') || 'Your Name\n0400 000 000\nAgency', align: 'left', weight: 600, size: Math.round(w * 0.03), xf: 0.22, yf: 0.9 },
      disclaimer: { ...base, text: 'All information believed accurate but not guaranteed — verify independently.', weight: 400, size: Math.round(w * 0.017), yf: 0.975, wrapf: 0.92, shadow: false, opacity: 0.85 },
      rect: { id: 0, type: 'rect', shape: 'rect', color: 'primary', xf: 0.5, yf: 0.88, wf: 1, hf: 0.16, radius: 0, opacity: 1, rot: 0 },
      ellipse: { id: 0, type: 'rect', shape: 'ellipse', color: 'accent', xf: 0.5, yf: 0.5, wf: 0.3, hf: 0.3, opacity: 1, rot: 0 },
      scrim: { id: 0, type: 'rect', shape: 'rect', color: 'dark', grad: 'up', xf: 0.5, yf: 0.84, wf: 1, hf: 0.5, radius: 0, opacity: 0.9, rot: 0 },
    };
  };
  const add = (kind) => {
    if (kind === 'logo' || kind === 'head') {
      const img = kind === 'logo' ? ctxData.brand.logoImg : ctxData.brand.headImg;
      if (!img || !img.width) return;
      const L = { id: uid++, type: 'image', src: kind, shape: kind === 'head' ? 'circle' : 'rect', xf: kind === 'head' ? 0.82 : 0.5, yf: kind === 'head' ? 0.85 : 0.5, wf: kind === 'head' ? 0.2 : 0.32, opacity: 1, rot: 0 };
      layers.push(L); selId = L.id; commit(); return;
    }
    const proto = presets()[kind];
    if (!proto) return;
    const L = { ...proto, id: uid++ };
    layers.push(L); selId = L.id; commit();
  };

  // ---- hit testing + drag ----------------------------------------------------
  let drag = null;
  const pt = (e) => {
    const r = cv.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (W() / r.width), y: (t.clientY - r.top) * (H() / r.height) };
  };
  // pointer in a layer's local (un-rotated, centred) frame
  const toLocal = (c, px, py) => {
    const dx = px - c.cx, dy = py - c.cy, a = -c.rot * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    return { lx: dx * cos - dy * sin, ly: dx * sin + dy * cos };
  };
  const hit = (x, y) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i]; if (L.hidden || L.locked || !L._c) continue;
      const slop = (L.size ? L.size * 0.4 : W() * 0.02) + (COARSE ? W() * 0.02 : 0);
      const { lx, ly } = toLocal(L._c, x, y);
      if (Math.abs(lx) <= L._c.w / 2 + L._c.pad + slop && Math.abs(ly) <= L._c.h / 2 + L._c.pad + slop) return L;
    }
    return null;
  };
  const sizeOf = (L) => (L.type === 'text' || L.type === 'badge') ? L.size : (L.type === 'rect' ? L.hf : L.wf);
  const setSize = (L, v) => {
    if (L.type === 'text' || L.type === 'badge') L.size = Math.max(12, Math.round(v));
    else if (L.type === 'rect') { const k = v / (L.hf || v); L.hf = Math.min(2, Math.max(0.02, v)); if (L.shape === 'ellipse') L.wf = Math.min(2, Math.max(0.02, L.wf * k)); }
    else L.wf = Math.min(2, Math.max(0.04, v));   // image keeps aspect (height derived)
  };
  const onDown = (e) => {
    const p = pt(e);
    const cur = layers.find((x) => x.id === selId);
    if (cur && cur._c && !cur.locked) {
      const br = boxCorners(cur._c)[2];
      if (Math.hypot(p.x - br.x, p.y - br.y) <= handleR() * 1.9) {
        drag = { id: cur.id, resize: true, startDist: Math.max(8, Math.hypot(p.x - cur._c.cx, p.y - cur._c.cy)), startSize: sizeOf(cur), moved: false };
        e.preventDefault(); return;
      }
    }
    const L = hit(p.x, p.y);
    selId = L ? L.id : null;
    if (L) { drag = { id: L.id, dx: p.x - L.xf * W(), dy: p.y - L.yf * H(), moved: false }; e.preventDefault(); }
    render(); syncPanel(); renderLayersPanel();
  };
  const SNAP = [0, 0.25, 0.5, 0.75, 1];
  const onMove = (e) => {
    if (!drag) return;
    drag.moved = true;
    const p = pt(e); const L = layers.find((x) => x.id === drag.id); if (!L) return;
    if (drag.resize) {
      const factor = Math.hypot(p.x - L._c.cx, p.y - L._c.cy) / drag.startDist;
      setSize(L, drag.startSize * factor);
      render(); syncPanel(); e.preventDefault(); return;
    }
    let xf = Math.min(1, Math.max(0, (p.x - drag.dx) / W()));
    let yf = Math.min(1, Math.max(0, (p.y - drag.dy) / H()));
    guides = [];
    const th = 0.012;
    SNAP.forEach((s) => { if (Math.abs(xf - s) < th) { xf = s; guides.push({ x: s * W() }); } });
    SNAP.forEach((s) => { if (Math.abs(yf - s) < th) { yf = s; guides.push({ y: s * H() }); } });
    L.xf = xf; L.yf = yf;
    render(); e.preventDefault();
  };
  const onUp = () => {
    if (drag && drag.moved) { guides = []; commit(); }
    else if (drag) guides = [];
    drag = null;
  };
  const onDblClick = (e) => {
    const L = hit(pt(e).x, pt(e).y);
    if (L && (L.type === 'text' || L.type === 'badge')) { selId = L.id; render(); syncPanel(); const t = $('stText'); t.focus(); t.select(); $('stLayerCtl').scrollIntoView({ block: 'nearest' }); }
  };

  // ---- history (undo / redo) -------------------------------------------------
  let history = [], hidx = -1, replaying = false;
  const clean = () => layers.map(({ _c, ...r }) => r);
  const snapshot = () => JSON.stringify({ sizeKey, bg, layers: clean() });
  const restoreSnap = (s) => { const o = JSON.parse(s); sizeKey = o.sizeKey; bg = JSON.parse(JSON.stringify(o.bg)); layers = JSON.parse(JSON.stringify(o.layers)); if (!layers.some((l) => l.id === selId)) selId = null; };
  const resetHistory = () => { history = [snapshot()]; hidx = 0; updateUndo(); };
  // commit a finished mutation: redraw, push history, autosave, refresh panels
  const commit = () => {
    render(); syncPanel(); renderLayersPanel();
    if (replaying) return;
    dirty = true;
    history = history.slice(0, hidx + 1);
    history.push(snapshot());
    if (history.length > 60) history.shift();
    hidx = history.length - 1;
    updateUndo(); autosave();
  };
  const afterRestore = () => {
    replaying = true;
    document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x.dataset.size === sizeKey));
    renderBgPicker(); render(); syncPanel(); renderLayersPanel(); updateUndo();
    replaying = false;
    autosave();
  };
  const undo = () => { if (hidx <= 0) return; hidx--; restoreSnap(history[hidx]); afterRestore(); };
  const redo = () => { if (hidx >= history.length - 1) return; hidx++; restoreSnap(history[hidx]); afterRestore(); };
  const updateUndo = () => { if ($('stUndo')) $('stUndo').disabled = hidx <= 0; if ($('stRedo')) $('stRedo').disabled = hidx >= history.length - 1; };

  // ---- clipboard -------------------------------------------------------------
  let clip = null;
  const pasteClip = () => {
    if (!clip) return;
    const n = { ...JSON.parse(clip), id: uid++ };
    n.xf = Math.min(0.96, (n.xf || 0.5) + 0.04); n.yf = Math.min(0.96, (n.yf || 0.5) + 0.04); delete n._c;
    layers.push(n); selId = n.id; commit();
  };
  const duplicate = () => { const L = sel(); if (!L) return; clip = (({ _c, ...r }) => JSON.stringify(r))(L); pasteClip(); };
  const removeSel = () => { if (!sel()) return; layers = layers.filter((x) => x.id !== selId); selId = null; commit(); };

  // ---- z-order / lock / hide -------------------------------------------------
  const idx = () => layers.findIndex((x) => x.id === selId);
  const forward = () => { const i = idx(); if (i < 0 || i >= layers.length - 1) return; [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]]; commit(); };
  const backward = () => { const i = idx(); if (i <= 0) return; [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]]; commit(); };
  const moveLayer = (id, dir) => { const i = layers.findIndex((x) => x.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= layers.length) return; [layers[i], layers[j]] = [layers[j], layers[i]]; commit(); };

  // ---- side panel ------------------------------------------------------------
  const sel = () => layers.find((x) => x.id === selId);
  const TOKENS = [['white', '#ffffff'], ['dark', '#1c2b30'], ['primary', null], ['accent', null]];
  const RECENT_LS = 'lk_studio_colors';
  const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_LS) || '[]'); } catch (e) { return []; } };
  const pushRecent = (hex) => { let r = recents().filter((x) => x !== hex); r.unshift(hex); r = r.slice(0, 6); try { localStorage.setItem(RECENT_LS, JSON.stringify(r)); } catch (e) {} };

  const renderBgPicker = () => {
    const box = $('stBg'); box.innerHTML = '';
    ctxData.photos.forEach((p, i) => {
      const im = document.createElement('img');
      im.src = p.url; im.className = 'st-bg-thumb' + (bg.type === 'photo' && bg.photoIndex === i ? ' active' : '');
      im.style.filter = p.fcss || '';
      im.addEventListener('click', () => { bg = { type: 'photo', photoIndex: i }; renderBgPicker(); commit(); });
      box.appendChild(im);
    });
    const col = document.createElement('button');
    col.className = 'st-bg-color' + (bg.type === 'color' ? ' active' : '');
    col.style.background = ctxData.brand.primary; col.title = 'Brand colour';
    col.addEventListener('click', () => { bg = { type: 'color' }; renderBgPicker(); commit(); });
    box.appendChild(col);
  };

  const layerLabel = (L) => {
    if (L.type === 'image') return L.src === 'logo' ? 'Logo' : 'Headshot';
    if (L.type === 'rect') return L.grad && L.grad !== 'none' ? 'Scrim' : (L.shape === 'ellipse' ? 'Ellipse' : 'Bar');
    const t = (L.text || '').split('\n')[0];
    return (t.length > 18 ? t.slice(0, 18) + '…' : t) || 'Text';
  };
  const renderLayersPanel = () => {
    const box = $('stLayers'); if (!box) return;
    box.innerHTML = '';
    if (!layers.length) { box.innerHTML = '<div class="st-tpl-empty">No layers yet — add one above.</div>'; return; }
    [...layers].reverse().forEach((L) => {
      const row = document.createElement('div');
      row.className = 'st-layer-row' + (L.id === selId ? ' active' : '');
      const name = document.createElement('button');
      name.className = 'st-layer-name'; name.textContent = layerLabel(L); name.title = 'Select';
      if (L.hidden) name.style.opacity = '.45';
      name.addEventListener('click', () => { selId = L.id; render(); syncPanel(); renderLayersPanel(); });
      const up = document.createElement('button'); up.className = 'st-layer-mini'; up.textContent = '▲'; up.title = 'Bring forward';
      up.addEventListener('click', () => moveLayer(L.id, 1));
      const dn = document.createElement('button'); dn.className = 'st-layer-mini'; dn.textContent = '▼'; dn.title = 'Send backward';
      dn.addEventListener('click', () => moveLayer(L.id, -1));
      const eye = document.createElement('button'); eye.className = 'st-layer-mini'; eye.textContent = L.hidden ? '🙈' : '👁'; eye.title = L.hidden ? 'Show' : 'Hide';
      eye.addEventListener('click', () => { L.hidden = !L.hidden; if (L.hidden && selId === L.id) selId = null; commit(); });
      const lock = document.createElement('button'); lock.className = 'st-layer-mini'; lock.textContent = L.locked ? '🔒' : '🔓'; lock.title = L.locked ? 'Unlock' : 'Lock';
      lock.addEventListener('click', () => { L.locked = !L.locked; commit(); });
      row.append(name, up, dn, eye, lock);
      box.appendChild(row);
    });
  };

  const setColor = (L, val) => { L.color = val; if (/^#/.test(val)) pushRecent(val); commit(); };
  const renderColorSwatches = (L) => {
    const cbox = $('stColors'); cbox.innerHTML = '';
    TOKENS.forEach(([key, hex]) => {
      const sw = document.createElement('button');
      sw.className = 'st-sw' + (L.color === key ? ' active' : '');
      sw.style.background = hex || resolveColor(key); sw.title = key;
      sw.addEventListener('click', () => setColor(L, key));
      cbox.appendChild(sw);
    });
    recents().forEach((hex) => {
      const sw = document.createElement('button');
      sw.className = 'st-sw' + (L.color === hex ? ' active' : '');
      sw.style.background = hex; sw.title = hex;
      sw.addEventListener('click', () => setColor(L, hex));
      cbox.appendChild(sw);
    });
    const pick = document.createElement('label'); pick.className = 'st-sw st-sw-pick'; pick.title = 'Custom colour';
    const inp = document.createElement('input'); inp.type = 'color'; inp.value = /^#[0-9a-f]{6}$/i.test(L.color) ? L.color : resolveColor(L.color);
    inp.addEventListener('input', () => { L.color = inp.value; render(); });
    inp.addEventListener('change', () => setColor(L, inp.value));
    pick.appendChild(inp); cbox.appendChild(pick);
  };

  const syncPanel = () => {
    const L = sel();
    $('stLayerCtl').hidden = !L;
    if (!L) return;
    const isText = L.type === 'text' || L.type === 'badge';
    const hasColor = isText || L.type === 'rect';
    const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };
    show('stText', isText); show('stSizeRow', isText); show('stColorWrap', hasColor);
    show('stRowStyle', isText); show('stRowAlign', L.type === 'text'); show('stRowShape', L.type === 'rect');
    show('stWrapRow', L.type === 'text');
    if (isText) {
      $('stText').value = L.text;
      $('stSize').value = L.size;
      $('stFont').textContent = L.font === 'serif' ? 'Serif' : 'Sans';
      $('stFont').classList.toggle('on', L.font === 'serif');
      $('stBold').classList.toggle('on', (L.weight || 0) >= 700);
      $('stShadow').classList.toggle('on', !!L.shadow);
      $('stOutline').classList.toggle('on', !!L.outline);
      $('stWrap').classList.toggle('on', !!L.wrapf);
      ['L', 'C', 'R'].forEach((a) => $('stAlign' + a).classList.toggle('on', L.align === { L: 'left', C: 'center', R: 'right' }[a]));
    }
    if (L.type === 'rect') {
      $('stShapeRect').classList.toggle('on', L.shape !== 'ellipse');
      $('stShapeEllipse').classList.toggle('on', L.shape === 'ellipse');
      $('stGrad').classList.toggle('on', !!(L.grad && L.grad !== 'none'));
    }
    if (hasColor) renderColorSwatches(L);
    $('stOpacity').value = Math.round((L.opacity == null ? 1 : L.opacity) * 100);
    $('stRot').value = L.rot || 0;
    $('stLock').textContent = L.locked ? '🔒 Locked' : '🔓 Lock';
    $('stLock').classList.toggle('on', !!L.locked);
    $('stHide').textContent = L.hidden ? '🙈 Hidden' : '👁 Visible';
  };

  // ---- starter template gallery ---------------------------------------------
  const STARTERS = {
    bar: () => ({ size: 'square', layers: ['scrim', 'badge', 'price', 'address', 'stats'] }),
    classic: () => ({ size: 'square', layers: ['badge', 'price', 'address', 'stats'], tweak: (ls) => { ls.forEach((l) => { l.font = 'serif'; }); const p = ls.find((l) => l.field === 'price'); if (p) p.yf = 0.46; const b = ls.find((l) => l.type === 'badge'); if (b) { b.xf = 0.5; b.yf = 0.16; } const a = ls.find((l) => l.field === 'address'); if (a) a.yf = 0.56; const s = ls.find((l) => l.field === 'stats'); if (s) s.yf = 0.62; } }),
    story: () => ({ size: 'story', layers: ['scrim', 'badge', 'price', 'address', 'stats'], tweak: (ls) => { const b = ls.find((l) => l.type === 'badge'); if (b) { b.xf = 0.5; b.yf = 0.1; } const p = ls.find((l) => l.field === 'price'); if (p) p.yf = 0.78; const a = ls.find((l) => l.field === 'address'); if (a) a.yf = 0.86; const s = ls.find((l) => l.field === 'stats'); if (s) s.yf = 0.91; } }),
    corner: () => ({ size: 'square', layers: ['scrim', 'price', 'address', 'stats', 'status'], tweak: (ls) => { const st = ls.find((l) => l.text === 'SOLD'); if (st) { st.xf = 0.74; st.yf = 0.16; } } }),
  };
  const applyStarter = (key) => {
    const spec = STARTERS[key]; if (!spec) return;
    const s = spec(); const p = presets();
    sizeKey = SIZES[s.size] ? s.size : 'square';
    document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x.dataset.size === sizeKey));
    bg = ctxData.photos.length ? { type: 'photo', photoIndex: (bg.type === 'photo' ? bg.photoIndex : 0) } : { type: 'color' };
    const ls = s.layers.map((k) => ({ ...p[k], id: uid++ }));
    if (s.tweak) s.tweak(ls);
    layers = ls; selId = null; renderBgPicker(); commit();
  };

  // ---- my templates (save layout, reuse on any listing) ---------------------
  const TPL_LS = 'lk_studio_templates';
  const loadTpls = () => { try { return JSON.parse(localStorage.getItem(TPL_LS) || '[]'); } catch (e) { return []; } };
  const saveTpls = (list) => { try { localStorage.setItem(TPL_LS, JSON.stringify(list)); } catch (e) {} };
  const saveTemplate = (name) => {
    const data = { v: 2, size: sizeKey, bg: { type: bg.type }, layers: clean() };
    const list = loadTpls();
    const existing = list.findIndex((t) => t.name.toLowerCase() === name.toLowerCase());
    if (existing >= 0) list[existing] = { name, data }; else list.push({ name, data });
    saveTpls(list); renderTplList();
  };
  const applyTemplate = (i) => {
    const t = loadTpls()[i]; if (!t || !t.data) return;
    sizeKey = SIZES[t.data.size] ? t.data.size : 'square';
    document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x.dataset.size === sizeKey));
    bg = (t.data.bg && t.data.bg.type === 'photo' && ctxData.photos.length) ? { type: 'photo', photoIndex: 0 } : { type: 'color' };
    layers = (t.data.layers || []).map((L) => {
      const n = { ...L, id: uid++ }; delete n._c;
      if (n.field && ctxData.fields[n.field] && !n.edited) n.text = ctxData.fields[n.field];
      return n;
    });
    selId = null; renderBgPicker(); commit();
  };
  const deleteTemplate = (i) => { const list = loadTpls(); list.splice(i, 1); saveTpls(list); renderTplList(); };
  const renderTplList = () => {
    const box = $('stTplList'); box.innerHTML = '';
    const list = loadTpls();
    if (!list.length) { box.innerHTML = '<div class="st-tpl-empty">No saved templates yet.</div>'; return; }
    list.forEach((t, i) => {
      const row = document.createElement('div'); row.className = 'st-tpl-item';
      const use = document.createElement('button'); use.className = 'st-tpl-use'; use.textContent = t.name;
      use.addEventListener('click', () => applyTemplate(i));
      const del = document.createElement('button'); del.className = 'st-tpl-del'; del.textContent = '×'; del.title = 'Delete template';
      del.addEventListener('click', () => deleteTemplate(i));
      row.appendChild(use); row.appendChild(del); box.appendChild(row);
    });
  };

  // ---- export ----------------------------------------------------------------
  const exportImage = (type) => {
    render(false);
    const slug = (ctxData.fields.address || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const ext = type === 'image/jpeg' ? 'jpg' : 'png';
    cv.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug}-${sizeKey}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, type, type === 'image/jpeg' ? 0.92 : undefined);
    render(true);
  };

  // ---- work-in-progress autosave / restore ----------------------------------
  const WIP_LS = 'lk_studio_wip';
  const addrKey = () => (ctxData.fields.address || ctxData.fields.price || '').trim();
  const autosave = () => { try { localStorage.setItem(WIP_LS, JSON.stringify({ addr: addrKey(), size: sizeKey, bg, layers: clean(), at: 1 })); } catch (e) {} };
  const loadWip = () => { try { return JSON.parse(localStorage.getItem(WIP_LS) || 'null'); } catch (e) { return null; } };
  const restoreWip = (wip) => {
    sizeKey = SIZES[wip.size] ? wip.size : 'square';
    document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x.dataset.size === sizeKey));
    bg = (wip.bg && wip.bg.type === 'photo' && ctxData.photos.length) ? wip.bg : (wip.bg || { type: 'color' });
    layers = (wip.layers || []).map((L) => { const n = { ...L }; delete n._c; uid = Math.max(uid, (n.id || 0) + 1); return n; });
    selId = null; $('stRestore').hidden = true;
    renderBgPicker(); render(); syncPanel(); renderLayersPanel(); resetHistory(); dirty = false;
  };

  // ---- open / wire -----------------------------------------------------------
  let wired = false;
  const wire = () => {
    if (wired) return; wired = true;
    cv = $('stCanvas'); ctx2d = cv.getContext('2d');
    cv.addEventListener('mousedown', onDown); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    cv.addEventListener('dblclick', onDblClick);
    cv.addEventListener('touchstart', onDown, { passive: false }); cv.addEventListener('touchmove', onMove, { passive: false }); cv.addEventListener('touchend', onUp);
    document.querySelectorAll('#stSizes button').forEach((b) => b.addEventListener('click', () => { sizeKey = b.dataset.size; document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x === b)); commit(); }));
    document.querySelectorAll('#stAdd button').forEach((b) => b.addEventListener('click', () => add(b.dataset.add)));
    document.querySelectorAll('#stStarters button').forEach((b) => b.addEventListener('click', () => applyStarter(b.dataset.tpl)));

    const cur = () => sel();
    $('stText').addEventListener('input', () => { const L = cur(); if (L) { L.text = $('stText').value; L.edited = true; render(); renderLayersPanel(); } });
    $('stText').addEventListener('change', commit);
    $('stSize').addEventListener('input', () => { const L = cur(); if (L) { L.size = Number($('stSize').value); render(); } });
    $('stSize').addEventListener('change', commit);
    $('stOpacity').addEventListener('input', () => { const L = cur(); if (L) { L.opacity = Number($('stOpacity').value) / 100; render(); } });
    $('stOpacity').addEventListener('change', commit);
    $('stRot').addEventListener('input', () => { const L = cur(); if (L) { L.rot = Number($('stRot').value); render(); } });
    $('stRot').addEventListener('change', commit);
    $('stFont').addEventListener('click', () => { const L = cur(); if (L) { L.font = L.font === 'serif' ? 'sans' : 'serif'; commit(); } });
    $('stBold').addEventListener('click', () => { const L = cur(); if (L) { L.weight = (L.weight || 0) >= 700 ? 400 : 800; commit(); } });
    $('stShadow').addEventListener('click', () => { const L = cur(); if (L) { L.shadow = !L.shadow; commit(); } });
    $('stOutline').addEventListener('click', () => { const L = cur(); if (L) { L.outline = !L.outline; commit(); } });
    $('stWrap').addEventListener('click', () => { const L = cur(); if (L) { L.wrapf = L.wrapf ? 0 : 0.82; commit(); } });
    ['L', 'C', 'R'].forEach((a) => $('stAlign' + a).addEventListener('click', () => { const L = cur(); if (L) { L.align = { L: 'left', C: 'center', R: 'right' }[a]; commit(); } }));
    $('stShapeRect').addEventListener('click', () => { const L = cur(); if (L) { L.shape = 'rect'; commit(); } });
    $('stShapeEllipse').addEventListener('click', () => { const L = cur(); if (L) { L.shape = 'ellipse'; commit(); } });
    $('stGrad').addEventListener('click', () => { const L = cur(); if (L) { L.grad = (L.grad && L.grad !== 'none') ? 'none' : 'up'; commit(); } });
    $('stForward').addEventListener('click', forward);
    $('stBackward').addEventListener('click', backward);
    $('stLock').addEventListener('click', () => { const L = cur(); if (L) { L.locked = !L.locked; commit(); } });
    $('stHide').addEventListener('click', () => { const L = cur(); if (L) { L.hidden = !L.hidden; if (L.hidden) selId = null; commit(); } });
    $('stDup').addEventListener('click', duplicate);
    $('stDel').addEventListener('click', removeSel);
    $('stUndo').addEventListener('click', undo);
    $('stRedo').addEventListener('click', redo);
    $('stExport').addEventListener('click', () => exportImage('image/png'));
    $('stExportJpg').addEventListener('click', () => exportImage('image/jpeg'));
    $('stClose').addEventListener('click', tryClose);
    $('stHelp').addEventListener('click', () => $('stCheats').hidden = !$('stCheats').hidden);
    $('stRestoreBtn').addEventListener('click', () => { const w = loadWip(); if (w) restoreWip(w); });
    $('stRestoreNo').addEventListener('click', () => { $('stRestore').hidden = true; });
    $('stTplSave').addEventListener('click', () => { const name = ($('stTplName').value || '').trim(); if (!name) { $('stTplName').focus(); return; } saveTemplate(name); $('stTplName').value = ''; });
    $('stTplName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('stTplSave').click(); } });

    // keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if ($('studio').hidden) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') { e.preventDefault(); if (!$('stCheats').hidden) { $('stCheats').hidden = true; return; } tryClose(); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (typing) return;
      const L = sel();
      if (mod && e.key.toLowerCase() === 'c') { if (L) { e.preventDefault(); clip = (({ _c, ...r }) => JSON.stringify(r))(L); } return; }
      if (mod && e.key.toLowerCase() === 'x') { if (L) { e.preventDefault(); clip = (({ _c, ...r }) => JSON.stringify(r))(L); removeSel(); } return; }
      if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClip(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); $('stCheats').hidden = !$('stCheats').hidden; return; }
      if (!L) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSel(); return; }
      if (e.key === '[') { e.preventDefault(); backward(); return; }
      if (e.key === ']') { e.preventDefault(); forward(); return; }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 0.05 : 0.005;
        if (e.key === 'ArrowLeft') L.xf = Math.max(0, L.xf - step);
        if (e.key === 'ArrowRight') L.xf = Math.min(1, L.xf + step);
        if (e.key === 'ArrowUp') L.yf = Math.max(0, L.yf - step);
        if (e.key === 'ArrowDown') L.yf = Math.min(1, L.yf + step);
        commit();
      }
    });
    // simple focus trap inside the overlay
    $('studio').addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...$('studio').querySelectorAll('button, input, textarea, [tabindex]')].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.addEventListener('beforeunload', (e) => { if (!$('studio').hidden && dirty) { e.preventDefault(); e.returnValue = ''; } });
  };

  let lastFocus = null;
  const open = (data, startSize) => {
    wire();
    ctxData = data;
    // read the previous session BEFORE seeding overwrites it (seeding autosaves)
    const wip = loadWip();
    sizeKey = startSize && SIZES[startSize] ? startSize : 'square';
    document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x.dataset.size === sizeKey));
    bg = ctxData.photos.length ? { type: 'photo', photoIndex: 0 } : { type: 'color' };
    layers = []; selId = null;
    const f = ctxData.fields;
    replaying = true;            // seed starter layers without touching history / autosave
    if (f.badge) add('badge');
    if (f.price) add('price');
    if (f.address) add('address');
    replaying = false;
    selId = null;
    $('stAddLogo').disabled = !(ctxData.brand.logoImg && ctxData.brand.logoImg.width);
    $('stAddHead').disabled = !(ctxData.brand.headImg && ctxData.brand.headImg.width);
    renderBgPicker(); renderTplList(); render(); syncPanel(); renderLayersPanel();
    resetHistory(); dirty = false; guides = [];
    $('stCheats').hidden = true;
    // offer to restore the previous unsaved session if it's the same listing
    $('stRestore').hidden = !(wip && wip.layers && wip.layers.length && wip.addr === addrKey());
    $('studio').hidden = false;
    document.body.style.overflow = 'hidden';
    lastFocus = document.activeElement;
    setTimeout(() => { const b = $('stUndo'); if (b) b.focus(); }, 30);
  };
  const tryClose = () => {
    if (dirty && !confirm('Close the design studio? Your layout is autosaved and will be offered when you reopen — but it won’t be exported.')) return;
    close();
  };
  const close = () => {
    $('studio').hidden = true; document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  };

  // reactive form→canvas binding: app calls this when listing fields change
  const refreshFields = (fields) => {
    if ($('studio').hidden || !ctxData) return;
    ctxData.fields = fields;
    let changed = false;
    layers.forEach((L) => { if (L.field && !L.edited && fields[L.field] != null && L.text !== fields[L.field]) { L.text = fields[L.field]; changed = true; } });
    if (changed) { render(); renderLayersPanel(); }
  };

  return { open, close, refreshFields };
})();
