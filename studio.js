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

  // photo colour-adjustment filters (honest: no house alteration) → CSS filter
  const photoFilterCSS = (f) => {
    if (!f) return '';
    const p = [];
    if (f.b != null && f.b !== 100) p.push(`brightness(${f.b}%)`);
    if (f.c != null && f.c !== 100) p.push(`contrast(${f.c}%)`);
    if (f.s != null && f.s !== 100) p.push(`saturate(${f.s}%)`);
    if (f.h) p.push(`hue-rotate(${f.h}deg)`);
    if (f.sep) p.push(`sepia(${f.sep}%)`);
    if (f.blur) p.push(`blur(${f.blur}px)`);
    return p.join(' ');
  };
  // advanced (pixel-level) adjustments that CSS filters can't do
  const ADV_KEYS = ['highlights', 'shadows', 'tint', 'vignette', 'sharpness'];
  const hasAdv = (f) => !!f && ADV_KEYS.some((k) => f[k]);
  const fKey = (f) => JSON.stringify(f || {});
  const sharpen = (cx, w, h, amt) => {
    const src = cx.getImageData(0, 0, w, h), out = cx.createImageData(w, h);
    const s = src.data, o = out.data, k = amt * 0.9;
    const wt = 1 + 4 * k;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const up = y > 0 ? s[i - w * 4 + c] : s[i + c], dn = y < h - 1 ? s[i + w * 4 + c] : s[i + c];
        const lf = x > 0 ? s[i - 4 + c] : s[i + c], rt = x < w - 1 ? s[i + 4 + c] : s[i + c];
        const v = s[i + c] * wt - k * (up + dn + lf + rt);
        o[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      o[i + 3] = s[i + 3];
    }
    cx.putImageData(out, 0, 0);
  };
  // bake CSS + pixel adjustments into a cached offscreen canvas; recompute only on change
  const processed = (img, f, host) => {
    if (!hasAdv(f)) return null;
    const key = fKey(f);
    if (host._procKey === key && host._procCv) return host._procCv;
    const max = 1400, sc = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * sc)), h = Math.max(1, Math.round(img.height * sc));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d');
    const css = photoFilterCSS(f); if (css) { try { c.filter = css; } catch (e) {} }
    c.drawImage(img, 0, 0, w, h); c.filter = 'none';
    let id; try { id = c.getImageData(0, 0, w, h); } catch (e) { host._procKey = key; host._procCv = cv; return cv; }
    const d = id.data, hi = (f.highlights || 0) / 100, sh = (f.shadows || 0) / 100, tint = (f.tint || 0) / 100;
    if (hi || sh || tint) {
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (sh) { const wgt = Math.max(0, 1 - lum * 1.4); const a = sh * 130 * wgt; r += a; g += a; b += a; }
        if (hi) { const wgt = Math.max(0, (lum - 0.35) * 1.6); const a = hi * 130 * wgt; r += a; g += a; b += a; }
        if (tint) { g += tint * 55; r -= tint * 28; b -= tint * 28; }   // green ↔ magenta
        d[i] = r < 0 ? 0 : r > 255 ? 255 : r; d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g; d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }
    c.putImageData(id, 0, 0);
    if (f.sharpness) sharpen(c, w, h, (f.sharpness || 0) / 100);
    if (f.vignette) { const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.62); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${(f.vignette / 100) * 0.75})`); c.fillStyle = g; c.fillRect(0, 0, w, h); }
    host._procKey = key; host._procCv = cv;
    return cv;
  };
  // draw a source (img or canvas) covering a box, honouring focus + crop {zoom, ox, oy}
  // the image point (normalised 0..1) shown at the frame centre, for the un-cropped
  // cover fit — i.e. exactly what visuals.js draws. Used as the crop's starting point.
  const coverCenter = (iw, ih, bw, bh, focus) => {
    const s0 = Math.max(bw / iw, bh / ih), dw0 = iw * s0, dh0 = ih * s0;
    const fy = { top: 0, center: 0.5, bottom: 1 }[focus || 'center'];
    return { cx: 0.5, cy: dh0 ? (bh / 2 - (bh - dh0) * fy) / dh0 : 0.5 };   // visuals always centres horizontally
  };
  const drawCover = (src, bx, by, bw, bh, focus, crop) => {
    const iw = src.width, ih = src.height;
    const z = (crop && crop.zoom) ? crop.zoom : 1;
    const s = Math.max(bw / iw, bh / ih) * z;
    const dw = iw * s, dh = ih * s;
    let dx, dy;
    if (crop && (crop.cx != null || crop.cy != null)) {
      // explicit crop: anchor the visible-centre point. Zoom keeps it fixed (crops in,
      // never drifts to a corner); pan range opens up the more you zoom.
      const cx = crop.cx != null ? crop.cx : 0.5, cy = crop.cy != null ? crop.cy : 0.5;
      dx = bx + bw / 2 - cx * dw; dy = by + bh / 2 - cy * dh;
    } else {
      // un-cropped: focus-based cover, identical to the generated graphic (stays faithful)
      const fy = { top: 0, center: 0.5, bottom: 1 }[focus || 'center'];
      dx = bx + (bw - dw) / 2; dy = by + (bh - dh) * fy;
    }
    dx = Math.min(bx, Math.max(bx + bw - dw, dx));
    dy = Math.min(by, Math.max(by + bh - dh, dy));
    ctx2d.drawImage(src, dx, dy, dw, dh);
  };
  // build a linear (by angle) or radial gradient fill across the canvas
  // (resolveColor so brand tokens like 'primary' work, not just #hex)
  const gradFill = (g, w, h) => {
    const c1 = resolveColor(g.c1), c2 = resolveColor(g.c2);
    if (g.radial) {
      const grd = ctx2d.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.05, w / 2, h / 2, Math.hypot(w, h) / 2);
      grd.addColorStop(0, c1); grd.addColorStop(1, c2); return grd;
    }
    const a = (g.angle || 0) * Math.PI / 180;
    const len = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * h) / 2;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    const grd = ctx2d.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
    grd.addColorStop(0, c1); grd.addColorStop(1, c2); return grd;
  };

  // ---- background ------------------------------------------------------------
  const drawBackground = () => {
    const w = W(), h = H();
    if (bg.type === 'photo' && ctxData.photos[bg.photoIndex] && ctxData.photos[bg.photoIndex].img) {
      const p = ctxData.photos[bg.photoIndex];
      const img = p.img;
      const proc = processed(img, bg.filter, bg);              // advanced ops baked (cached) when present
      ctx2d.save();
      if (!proc) { const css = bg.filter ? photoFilterCSS(bg.filter) : (p.fcss || photoFilterCSS(p.filter)); if (css) { try { ctx2d.filter = css; } catch (e) {} } }
      drawCover(proc || img, 0, 0, w, h, p.focus, bg.crop);
      ctx2d.restore();
      ctx2d.filter = 'none';
      if (bg.darken) { ctx2d.fillStyle = `rgba(0,0,0,${bg.darken})`; ctx2d.fillRect(0, 0, w, h); }
    } else if (bg.type === 'gradient') {
      ctx2d.fillStyle = gradFill(bg, w, h); ctx2d.fillRect(0, 0, w, h);
    } else if (bg.type === 'color') {
      ctx2d.fillStyle = resolveColor(bg.color || ctxData.brand.primary); ctx2d.fillRect(0, 0, w, h);
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
  const HAS_LS = (() => { try { return 'letterSpacing' in (document.createElement('canvas').getContext('2d')); } catch (e) { return false; } })();
  const measure = (L) => {
    ctx2d.font = fontStr(L);
    if (HAS_LS) { try { ctx2d.letterSpacing = (L.tracking || 0) + 'px'; } catch (e) {} }
    const maxW = L.wrapf ? L.wrapf * W() : 0;
    const lines = wrapLines(L.text, maxW);
    let textW = 0;
    lines.forEach((ln) => { textW = Math.max(textW, ctx2d.measureText(ln).width); });
    if (HAS_LS) { try { ctx2d.letterSpacing = '0px'; } catch (e) {} }   // don't leak onto later measures
    const lh = L.size * (L.lineh || 1.25);
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
    if (L.blend && L.blend !== 'source-over') ctx2d.globalCompositeOperation = L.blend;

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
      const sh = L.shape;
      if (sh === 'line') {
        // a clean rule / line: a rounded-cap stroke whose thickness is the box height
        ctx2d.strokeStyle = fill; ctx2d.lineWidth = Math.max(1, bh); ctx2d.lineCap = 'round';
        ctx2d.beginPath(); ctx2d.moveTo(x + bh / 2, 0); ctx2d.lineTo(x + bw - bh / 2, 0); ctx2d.stroke();
        ctx2d.lineCap = 'butt';
      } else {
        const trace = () => {
          ctx2d.beginPath();
          if (sh === 'ellipse') ctx2d.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2);
          else if (sh === 'triangle') { ctx2d.moveTo(0, y); ctx2d.lineTo(bw / 2, bh / 2); ctx2d.lineTo(-bw / 2, bh / 2); ctx2d.closePath(); }
          else if (sh === 'diamond') { ctx2d.moveTo(0, y); ctx2d.lineTo(bw / 2, 0); ctx2d.lineTo(0, bh / 2); ctx2d.lineTo(-bw / 2, 0); ctx2d.closePath(); }
          else if (sh === 'arrow') { const hw = bh * 0.28; ctx2d.moveTo(x, -hw); ctx2d.lineTo(bw * 0.12, -hw); ctx2d.lineTo(bw * 0.12, y); ctx2d.lineTo(bw / 2, 0); ctx2d.lineTo(bw * 0.12, bh / 2); ctx2d.lineTo(bw * 0.12, hw); ctx2d.lineTo(x, hw); ctx2d.closePath(); }
          else if (sh === 'star') { let a = -Math.PI / 2; const st = Math.PI / 5; ctx2d.moveTo(0, y); for (let i = 0; i < 5; i++) { a += st; ctx2d.lineTo(Math.cos(a) * bw * 0.21, Math.sin(a) * bh * 0.21); a += st; ctx2d.lineTo(Math.cos(a) * bw / 2, Math.sin(a) * bh / 2); } ctx2d.closePath(); }
          else if (L.radius) roundRect(x, y, bw, bh, L.radius);
          else ctx2d.rect(x, y, bw, bh);
        };
        if (!L.noFill) { trace(); ctx2d.fill(); }
        if (L.stroke) { ctx2d.lineWidth = Math.max(1, L.strokeWf * w); ctx2d.strokeStyle = resolveColor(L.stroke); trace(); ctx2d.stroke(); }
      }
    } else if (L.type === 'image' || L.type === 'photo') {
      let img, draw, useFilter = '';
      if (L.type === 'photo') {
        const p = ctxData.photos[L.photoIndex]; img = p && p.img;
        const proc = img ? processed(img, L.filter, L) : null;   // advanced ops baked (cached)
        draw = proc || img;
        if (!proc) useFilter = photoFilterCSS(L.filter);
      } else { img = L.src === 'logo' ? ctxData.brand.logoImg : ctxData.brand.headImg; draw = img; }
      if (!img || !img.width) { ctx2d.restore(); L._c = { cx, cy, w: 0, h: 0, rot: L.rot || 0, pad: 0 }; return; }
      if (useFilter) { try { ctx2d.filter = useFilter; } catch (e) {} }
      const dw = L.wf * w;
      if (L.type === 'photo' && L.hf) {
        // cover-fit into a wf×hf box (used by the faithful template reproductions)
        const bxw = L.wf * w, bxh = L.hf * h;
        ctx2d.save();
        if (L.shape === 'circle') { ctx2d.beginPath(); ctx2d.arc(0, 0, Math.min(bxw, bxh) / 2, 0, Math.PI * 2); ctx2d.clip(); }
        else if (L.radius) { roundRect(-bxw / 2, -bxh / 2, bxw, bxh, L.radius); ctx2d.clip(); }
        else { ctx2d.beginPath(); ctx2d.rect(-bxw / 2, -bxh / 2, bxw, bxh); ctx2d.clip(); }
        drawCover(draw, -bxw / 2, -bxh / 2, bxw, bxh, L.focus, L.crop);
        ctx2d.restore();
        bw = bxw; bh = bxh;
      } else if (L.shape === 'circle') {
        const d = dw, s = Math.max(d / draw.width, d / draw.height);
        ctx2d.save(); ctx2d.beginPath(); ctx2d.arc(0, 0, d / 2, 0, Math.PI * 2); ctx2d.clip();
        ctx2d.drawImage(draw, -draw.width * s / 2, -draw.height * s / 2, draw.width * s, draw.height * s);
        ctx2d.restore();
        bw = d; bh = d;
      } else {
        const dh = dw * (draw.height / draw.width);
        if (L.shape === 'rounded' && L.radius) { ctx2d.save(); roundRect(-dw / 2, -dh / 2, dw, dh, L.radius); ctx2d.clip(); ctx2d.drawImage(draw, -dw / 2, -dh / 2, dw, dh); ctx2d.restore(); }
        else ctx2d.drawImage(draw, -dw / 2, -dh / 2, dw, dh);
        bw = dw; bh = dh;
      }
      ctx2d.filter = 'none';
    } else if (L.type === 'ribbon') {
      // a filled banner with centred text (rotate via L.rot to make a corner ribbon)
      ctx2d.font = `800 ${L.size}px ${SANS}`;
      bw = (L.wf || 0.6) * w; bh = L.size * 1.9;
      ctx2d.fillStyle = resolveColor(L.color);
      ctx2d.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx2d.strokeStyle = 'rgba(255,255,255,.5)'; ctx2d.lineWidth = Math.max(1, L.size * 0.04);
      ctx2d.strokeRect(-bw / 2 + L.size * 0.25, -bh / 2 + L.size * 0.25, bw - L.size * 0.5, bh - L.size * 0.5);
      ctx2d.fillStyle = onColor(resolveColor(L.color));
      ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
      const oldSp = ctx2d.letterSpacing; try { ctx2d.letterSpacing = (L.size * 0.12) + 'px'; } catch (e) {}
      ctx2d.fillText(String(L.text || '').toUpperCase(), 0, 1);
      try { ctx2d.letterSpacing = oldSp || '0px'; } catch (e) {}
    } else if (L.type === 'statsstrip') {
      // pill chips parsed from the stats fact, e.g. "4 BD · 2 BA · 2 CAR · 520 M²"
      const parts = String(L.text || '').split(/[·•|]/).map((s) => s.trim()).filter(Boolean);
      ctx2d.font = `700 ${L.size}px ${SANS}`;
      const padX = L.size * 0.7, gap = L.size * 0.45, chh = L.size * 2;
      const widths = parts.map((p) => ctx2d.measureText(p).width + padX * 2);
      const totalW = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1);
      let x = -totalW / 2;
      ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
      parts.forEach((p, k) => {
        const cw = widths[k];
        ctx2d.fillStyle = resolveColor(L.color);
        roundRect(x, -chh / 2, cw, chh, chh / 2); ctx2d.fill();
        ctx2d.fillStyle = onColor(resolveColor(L.color));
        ctx2d.fillText(p, x + cw / 2, 1);
        x += cw + gap;
      });
      bw = totalW || L.size; bh = chh;
    } else {
      // text + badge
      const m = measure(L);
      ctx2d.textBaseline = 'top';
      if (HAS_LS) { try { ctx2d.letterSpacing = (L.tracking || 0) + 'px'; } catch (e) {} }   // re-apply for drawing (measure reset it)
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
        const drawLines = (style) => { ctx2d.fillStyle = style; m.lines.forEach((ln, i) => ctx2d.fillText(ln, ax, startY + i * m.lh)); };
        // outer glow (soft halo) — drawn first so text sits on top
        if (L.glow) { ctx2d.save(); ctx2d.shadowColor = resolveColor(L.glowColor || 'white'); ctx2d.shadowBlur = L.size * 0.6; drawLines(fill); ctx2d.restore(); }
        // drop shadow on the real fill
        if (L.shadow) { ctx2d.shadowColor = 'rgba(0,0,0,.45)'; ctx2d.shadowBlur = L.size * 0.25; ctx2d.shadowOffsetY = 2; }
        if (L.outline) {
          ctx2d.lineWidth = L.size * 0.1; ctx2d.lineJoin = 'round';
          ctx2d.strokeStyle = L.stroke ? resolveColor(L.stroke) : onColor(fill);
          m.lines.forEach((ln, i) => ctx2d.strokeText(ln, ax, startY + i * m.lh));
        }
        // gradient or solid fill
        let style = fill;
        if (L.tgrad) {
          const g = ctx2d.createLinearGradient(0, startY, 0, startY + m.bh);
          g.addColorStop(0, resolveColor(L.tgrad[0]));
          g.addColorStop(1, resolveColor(L.tgrad[1]));
          style = g;
        }
        drawLines(style);
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
      ribbon: { ...base, type: 'ribbon', text: 'SOLD', color: '#c0392b', wf: 0.62, size: Math.round(w * 0.04), xf: 0.74, yf: 0.2, rot: 45 },
      statsstrip: { ...base, type: 'statsstrip', field: 'stats', text: f.stats || '4 BD · 2 BA · 2 CAR', color: 'primary', size: Math.round(w * 0.028), yf: 0.9, xf: 0.5, shadow: false },
      rect: { id: 0, type: 'rect', shape: 'rect', color: 'primary', xf: 0.5, yf: 0.88, wf: 1, hf: 0.16, radius: 0, opacity: 1, rot: 0 },
      ellipse: { id: 0, type: 'rect', shape: 'ellipse', color: 'accent', xf: 0.5, yf: 0.5, wf: 0.3, hf: 0.3, opacity: 1, rot: 0 },
      line: { id: 0, type: 'rect', shape: 'line', color: 'primary', xf: 0.5, yf: 0.5, wf: 0.5, hf: 0.012, radius: 0, opacity: 1, rot: 0 },
      triangle: { id: 0, type: 'rect', shape: 'triangle', color: 'accent', xf: 0.5, yf: 0.5, wf: 0.26, hf: 0.26, radius: 0, opacity: 1, rot: 0 },
      diamond: { id: 0, type: 'rect', shape: 'diamond', color: 'accent', xf: 0.5, yf: 0.5, wf: 0.24, hf: 0.24, radius: 0, opacity: 1, rot: 0 },
      arrow: { id: 0, type: 'rect', shape: 'arrow', color: 'accent', xf: 0.5, yf: 0.5, wf: 0.32, hf: 0.18, radius: 0, opacity: 1, rot: 0 },
      star: { id: 0, type: 'rect', shape: 'star', color: 'accent', xf: 0.5, yf: 0.5, wf: 0.26, hf: 0.26, radius: 0, opacity: 1, rot: 0 },
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
    if (kind === 'photo') {
      if (!ctxData.photos.length) return;
      const pi = bg.type === 'photo' ? bg.photoIndex : 0;
      const img = ctxData.photos[pi] && ctxData.photos[pi].img;
      const wf = 0.5;
      // give it a box (wf×hf) at the photo's native aspect so it looks unchanged but supports crop (zoom/pan)
      const hf = (img && img.width) ? wf * W() * (img.height / img.width) / H() : wf;
      const L = { id: uid++, type: 'photo', photoIndex: pi, shape: 'rect', radius: Math.round(W() * 0.03), xf: 0.5, yf: 0.5, wf, hf, crop: { zoom: 1, ox: 0, oy: 0 }, filter: { b: 100, c: 100, s: 100, h: 0, sep: 0, blur: 0 }, opacity: 1, rot: 0 };
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
  let pinch = null;
  const touchSpread = (e) => { const a = e.touches[0], b = e.touches[1]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); };
  const onDown = (e) => {
    // two fingers on the canvas = pinch-to-zoom the photo (crop). Works on the background
    // photo (modern) or a selected photo layer — the natural way to crop on a phone.
    if (e.touches && e.touches.length === 2) {
      const t = pinchTarget();
      if (t) { ensureCropCenter(t); pinch = { t, d0: touchSpread(e), z0: (t.crop && t.crop.zoom) || 1 }; drag = null; render(); syncPanel(); renderLayersPanel(); }
      e.preventDefault(); return;
    }
    const p = pt(e);
    const cur = layers.find((x) => x.id === selId);
    if (cur && cur._c && !cur.locked) {
      const br = boxCorners(cur._c)[2];
      if (Math.hypot(p.x - br.x, p.y - br.y) <= handleR() * 1.9) {
        bgEdit = false;   // resizing a layer leaves background-adjust mode
        // capture the starting dimensions so resize scales from them (no drift / clamp distortion)
        drag = { id: cur.id, resize: true, startDist: Math.max(8, Math.hypot(p.x - cur._c.cx, p.y - cur._c.cy)), startSize: sizeOf(cur), startWf: cur.wf, startHf: cur.hf, moved: false };
        e.preventDefault(); return;
      }
    }
    const L = hit(p.x, p.y);
    selId = L ? L.id : null;
    if (L) {
      bgEdit = false;
      drag = { id: L.id, dx: p.x - L.xf * W(), dy: p.y - L.yf * H(), moved: false };
      e.preventDefault();
    } else if (bg.type === 'photo') {
      // tap the empty canvas = grab the BACKGROUND photo: opens its adjust/crop panel,
      // and drag-to-pan repositions the crop (the obvious "edit the photo" gesture)
      bgEdit = true;
      bg.crop = bg.crop || {};
      const ph = ctxData.photos[bg.photoIndex], im = ph && ph.img;
      const c0 = (bg.crop.cx != null) ? { cx: bg.crop.cx, cy: bg.crop.cy != null ? bg.crop.cy : 0.5 }
        : (im && im.width) ? coverCenter(im.width, im.height, W(), H(), ph.focus) : { cx: 0.5, cy: 0.5 };
      drag = { bgPan: true, sx: p.x, sy: p.y, cx0: c0.cx, cy0: c0.cy, moved: false };
      e.preventDefault();
    } else {
      bgEdit = false;
    }
    render(); syncPanel(); renderLayersPanel();
  };
  const SNAP = [0, 0.25, 0.5, 0.75, 1];
  const onMove = (e) => {
    if (pinch && e.touches && e.touches.length === 2) {
      const t = pinch.t;
      t.crop = t.crop || {};
      t.crop.zoom = Math.min(4, Math.max(1, pinch.z0 * (touchSpread(e) / pinch.d0)));
      render(); syncPanel();
      e.preventDefault(); return;
    }
    if (!drag) return;
    drag.moved = true;
    const p = pt(e);
    if (drag.bgPan) {
      // drag the background photo to reposition its crop (1:1 with the cursor)
      const ph = ctxData.photos[bg.photoIndex], img = ph && ph.img;
      if (img && img.width) {
        const z = (bg.crop && bg.crop.zoom) ? bg.crop.zoom : 1;
        const s = Math.max(W() / img.width, H() / img.height) * z;
        const dw = img.width * s, dh = img.height * s;
        bg.crop = bg.crop || {};
        // grab-and-move: dragging right reveals the LEFT of the photo → centre point moves left
        bg.crop.cx = Math.min(1, Math.max(0, drag.cx0 - (p.x - drag.sx) / dw));
        bg.crop.cy = Math.min(1, Math.max(0, drag.cy0 - (p.y - drag.sy) / dh));
        render();
      }
      e.preventDefault(); return;
    }
    const L = layers.find((x) => x.id === drag.id); if (!L) return;
    if (drag.resize) {
      const factor = Math.hypot(p.x - L._c.cx, p.y - L._c.cy) / drag.startDist;
      if (L.type === 'text' || L.type === 'badge') L.size = Math.max(12, Math.round(drag.startSize * factor));
      else if (L.type === 'rect') {
        L.hf = Math.min(2, Math.max(0.008, drag.startHf * factor));
        if (L.shape !== 'rect') L.wf = Math.min(2, Math.max(0.02, drag.startWf * factor));   // ellipse/triangle/star/etc keep aspect
      } else { L.wf = Math.min(2, Math.max(0.04, drag.startWf * factor)); if (L.type === 'photo' && drag.startHf) L.hf = Math.min(2, Math.max(0.04, drag.startHf * factor)); }   // image/photo keep aspect (box photos scale both)
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
  const onUp = (e) => {
    if (pinch) { if (!e || !e.touches || e.touches.length < 2) { commit(); revealPhotoControls(); pinch = null; } return; }
    const wasTap = drag && !drag.moved;
    if (drag && drag.moved) { guides = []; commit(); }
    else if (drag) guides = [];
    drag = null;
    // a tap that landed on a photo (layer or background) → bring its crop controls into view
    if (wasTap) revealPhotoControls();
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
    if (!inRebuild) rebuiltFrom = null;   // any manual edit detaches from the rebuilt style
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
  // slider helpers: snap to the nearest "nice" value within a threshold, and a readout
  const snapTo = (v, pts, th) => { for (const p of pts) if (Math.abs(v - p) <= th) return p; return v; };
  const slv = (id, txt) => { const e = $(id); if (e) e.textContent = txt; };
  const TOKENS = [['white', '#ffffff'], ['dark', '#1c2b30'], ['primary', null], ['accent', null]];
  const RECENT_LS = 'lk_studio_colors';
  const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_LS) || '[]'); } catch (e) { return []; } };
  const pushRecent = (hex) => { let r = recents().filter((x) => x !== hex); r.unshift(hex); r = r.slice(0, 6); try { localStorage.setItem(RECENT_LS, JSON.stringify(r)); } catch (e) {} };

  // photo editing can target a photo LAYER or the BACKGROUND photo
  let bgEdit = false;
  let rebuiltFrom = null, inRebuild = false;   // track if the current design came straight from a style rebuild
  const photoT = () => { const L = sel(); if (L && L.type === 'photo') return L; if (!selId && bgEdit && bg.type === 'photo') return bg; return null; };
  // when a photo becomes the edit target, scroll its adjust/crop controls into view —
  // otherwise they sit far below the fold and the crop feels "missing".
  const revealPhotoControls = () => {
    if (!photoT()) return;
    const panel = document.querySelector('.studio-panel'), el = $('stPhotoCtl');
    if (!panel || !el || el.hidden) return;
    const delta = el.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8;
    if (Math.abs(delta) > 16) panel.scrollTop += delta;
  };
  // seed a crop's visible-centre (cx,cy) from the focus cover-centre so zoom never drifts.
  const ensureCropCenter = (t) => {
    t.crop = t.crop || {};
    if (t.crop.cx != null && t.crop.cy != null) return;
    const isBg = (t === bg);
    const box = isBg ? { w: W(), h: H() } : { w: (t.wf || 0.5) * W(), h: (t.hf || 0.5) * H() };
    const pObj = ctxData.photos[isBg ? bg.photoIndex : t.photoIndex];
    const im = pObj && pObj.img;
    const c = (im && im.width) ? coverCenter(im.width, im.height, box.w, box.h, pObj.focus) : { cx: 0.5, cy: 0.5 };
    if (t.crop.cx == null) t.crop.cx = c.cx;
    if (t.crop.cy == null) t.crop.cy = c.cy;
  };
  // the photo we should pinch-zoom: a selected photo LAYER, else the background photo
  // (auto-entering background-edit so pinching the modern full-bleed photo just works).
  const pinchTarget = () => {
    const L = sel(); if (L && L.type === 'photo') return L;
    if (bg.type === 'photo') { bgEdit = true; selId = null; return bg; }
    return null;
  };

  // photo colour-adjust + shape/crop panel (works for a layer or the background)
  const syncPhotoPanel = (t) => {
    const isBg = (t === bg);
    t.filter = t.filter || (isBg ? {} : { b: 100, c: 100, s: 100, h: 0, sep: 0, blur: 0 });
    const f = t.filter;
    $('stPhTitle').childNodes[0].nodeValue = isBg ? 'Background photo ' : 'Photo ';
    $('stPhHint').textContent = isBg ? '— drag the photo to reposition · zoom & crop below' : '— zoom & crop below · drag/corner-resize on canvas';
    const applyRow = $('stBgApplyRow'); if (applyRow) applyRow.hidden = !(isBg && ctxData && ctxData.onApplyPhotoAdjust);
    $('stPhShapeRow').style.display = isBg ? 'none' : '';
    if (!isBg) {
      $('stPhRect').classList.toggle('on', t.shape !== 'rounded' && t.shape !== 'circle');
      $('stPhRound').classList.toggle('on', t.shape === 'rounded');
      $('stPhCircle').classList.toggle('on', t.shape === 'circle');
      $('stPhRadiusRow').style.display = t.shape === 'rounded' ? '' : 'none';
      $('stPhRadius').value = t.radius || 0; slv('stPhRadiusV', Math.round(t.radius || 0) + '');
    } else { $('stPhRadiusRow').style.display = 'none'; }
    const cropAble = isBg || (!isBg && t.hf);   // bg, or a box photo layer
    $('stPhCrop').hidden = !cropAble;
    const set = (id, v, suf) => { $(id).value = v; slv(id + 'V', v + suf); };
    if (cropAble) {
      const cr = t.crop || {};
      const z = cr.zoom || 1;
      set('stPhZoom', Math.round(z * 100), '%');
      const box = isBg ? { w: W(), h: H() } : { w: (t.wf || 0.5) * W(), h: (t.hf || 0.5) * H() };
      const pObj = ctxData.photos[isBg ? bg.photoIndex : t.photoIndex];
      const im = pObj && pObj.img;
      const base = (im && im.width) ? coverCenter(im.width, im.height, box.w, box.h, pObj.focus) : { cx: 0.5, cy: 0.5 };
      const cx = cr.cx != null ? cr.cx : base.cx, cy = cr.cy != null ? cr.cy : base.cy;
      set('stPhPanX', Math.round((cx - 0.5) * 200), '');
      set('stPhPanY', Math.round((cy - 0.5) * 200), '');
      // a wide photo fully fills the frame vertically (and vice-versa): that pan axis has no
      // room until you zoom in. Disable it + guide the user, so it doesn't feel broken.
      let roomX = true, roomY = true;
      if (im && im.width) { const s0 = Math.max(box.w / im.width, box.h / im.height); roomX = im.width * s0 * z - box.w > 1; roomY = im.height * s0 * z - box.h > 1; }
      const lock = (id, room) => { const el = $(id); el.disabled = !room; const row = el.closest('.st-slider'); if (row) row.classList.toggle('locked', !room); };
      lock('stPhPanX', roomX); lock('stPhPanY', roomY);
      const move = isBg ? 'drag the photo' : 'drag/resize on canvas';
      $('stPhHint').textContent = (!roomX && !roomY) ? '— zoom in to crop & reposition'
        : !roomY ? `— ${move} · zoom in to move up/down`
        : !roomX ? `— ${move} · zoom in to move sideways`
        : `— ${move} · zoom to crop in`;
    }
    set('stPhB', f.b == null ? 100 : f.b, '%'); set('stPhC', f.c == null ? 100 : f.c, '%'); set('stPhS', f.s == null ? 100 : f.s, '%');
    set('stPhHi', f.highlights || 0, ''); set('stPhSh', f.shadows || 0, '');
    set('stPhHue', f.h || 0, '°'); set('stPhSep', f.sep || 0, '%');
    set('stPhTint', f.tint || 0, ''); set('stPhSharp', f.sharpness || 0, ''); set('stPhVig', f.vignette || 0, '');
  };

  // curated background colours + gradients
  const BG_PRESETS = () => {
    const b = ctxData.brand;
    return [
      { type: 'color', color: '#ffffff' },
      { type: 'color', color: '#111417' },
      { type: 'gradient', c1: '#4a4a4a', c2: '#000000', angle: 135 },   // dark black gradient (replaces solid brand tile)
      { type: 'gradient', c1: Visuals.shade(b.primary, 22), c2: Visuals.shade(b.primary, -30), angle: 135 },
      { type: 'gradient', c1: b.primary, c2: b.accent, angle: 135 },
      { type: 'gradient', c1: '#2193b0', c2: '#6dd5ed', angle: 135 },
      { type: 'gradient', c1: '#0f2027', c2: '#2c5364', angle: 135 },
      { type: 'gradient', c1: '#3a1c71', c2: '#d76d77', angle: 135 },
      { type: 'gradient', c1: '#ee9ca7', c2: '#ffdde1', angle: 135 },
      { type: 'gradient', c1: '#f7971e', c2: '#ffd200', angle: 135 },
      { type: 'gradient', c1: '#c9a36a', c2: '#5d4a2e', angle: 135 },
      { type: 'gradient', c1: '#283048', c2: '#859398', angle: 135 },
    ];
  };
  const presetCSS = (p) => p.type === 'color' ? p.color : `linear-gradient(${(p.angle || 135)}deg, ${p.c1}, ${p.c2})`;
  const sameBg = (p) => p.type === bg.type && (p.type === 'color' ? p.color === bg.color : (p.c1 === bg.c1 && p.c2 === bg.c2 && !bg.radial));

  const renderBgPicker = () => {
    const box = $('stBg'); box.innerHTML = '';
    ctxData.photos.forEach((p, i) => {
      const im = document.createElement('img');
      im.src = p.url; im.className = 'st-bg-thumb' + (bg.type === 'photo' && bg.photoIndex === i ? ' active' : '');
      im.style.filter = p.fcss || photoFilterCSS(p.filter) || '';
      im.addEventListener('click', () => { bg = { type: 'photo', photoIndex: i, darken: bg.type === 'photo' ? (bg.darken || 0) : 0 }; renderBgPicker(); commit(); });
      box.appendChild(im);
    });
    if (!ctxData.photos.length) box.innerHTML = '<div class="st-tpl-empty">No photos yet — upload one below, or use a colour.</div>';

    // colour / gradient preset tiles
    const pbox = $('stBgPresets'); pbox.innerHTML = '';
    BG_PRESETS().forEach((p) => {
      const t = document.createElement('button');
      t.className = 'st-bg-preset' + (sameBg(p) ? ' active' : '');
      t.style.background = presetCSS(p); t.title = p.type === 'color' ? p.color : 'gradient';
      t.addEventListener('click', () => { bg = { ...p }; renderBgPicker(); commit(); });
      pbox.appendChild(t);
    });

    // custom gradient inputs reflect the current gradient (or sensible defaults)
    const b = ctxData.brand;
    $('stBgC1').value = (bg.type === 'gradient' ? bg.c1 : (bg.type === 'color' ? bg.color : b.primary));
    $('stBgC2').value = (bg.type === 'gradient' ? bg.c2 : b.accent);
    const ang = bg.type === 'gradient' ? (bg.angle || 0) : 135;
    $('stBgAngle').value = ang; slv('stBgAngleV', ang + '°');
    $('stBgRadial').classList.toggle('on', !!(bg.type === 'gradient' && bg.radial));

    // photo-only darken control
    $('stBgPhoto').hidden = bg.type !== 'photo';
    const dk = Math.round((bg.darken || 0) * 100);
    $('stBgDarken').value = dk; slv('stBgDarkenV', dk + '%');
    const ap = $('stAddPhoto'); if (ap) ap.disabled = !ctxData.photos.length;
  };

  const layerLabel = (L) => {
    if (L.type === 'image') return L.src === 'logo' ? 'Logo' : 'Headshot';
    if (L.type === 'photo') return 'Photo';
    if (L.type === 'ribbon') return 'Ribbon: ' + String(L.text || '').slice(0, 12);
    if (L.type === 'statsstrip') return 'Stats strip';
    if (L.type === 'rect') {
      const SHAPE_NAME = { ellipse: 'Ellipse', triangle: 'Triangle', diamond: 'Diamond', arrow: 'Arrow', star: 'Star', line: 'Line' };
      if (SHAPE_NAME[L.shape]) return SHAPE_NAME[L.shape];
      return L.grad && L.grad !== 'none' ? 'Scrim' : 'Bar';
    }
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
      name.addEventListener('click', () => { selId = L.id; bgEdit = false; render(); syncPanel(); renderLayersPanel(); revealPhotoControls(); });
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
    if (bgEdit && bg.type !== 'photo') bgEdit = false;   // bg switched to colour/gradient → leave bg-edit
    const pt = photoT();
    $('stLayerCtl').hidden = !L;
    const pcEl = $('stPhotoCtl'); if (pcEl) pcEl.hidden = !pt;
    if (pt) syncPhotoPanel(pt);
    // obvious "crop the photo" entry, shown whenever the background is a photo
    const fab = $('stCropFab');
    if (fab) {
      const cropping = bgEdit && bg.type === 'photo';
      fab.hidden = bg.type !== 'photo';
      fab.classList.toggle('on', cropping);
      fab.textContent = cropping ? '✓ Cropping — drag · pinch · sliders below' : '✎ Crop / reposition photo';
    }
    if (!L) { updateContrast(); return; }   // nothing selected (but bg panel may still show)
    const isText = L.type === 'text' || L.type === 'badge';
    const hasColor = isText || L.type === 'rect';
    const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? '' : 'none'; };
    show('stText', isText); show('stSizeRow', isText); show('stColorWrap', hasColor);
    show('stRowStyle', isText); show('stRowAlign', L.type === 'text'); show('stRowShape', L.type === 'rect');
    show('stWrapRow', L.type === 'text');
    show('stTrackRow', isText); show('stLinehRow', isText);
    $('stTrack').value = L.tracking || 0; slv('stTrackV', (L.tracking || 0) + 'px');
    $('stLineh').value = Math.round((L.lineh || 1.25) * 100); slv('stLinehV', Math.round((L.lineh || 1.25) * 100) + '%');
    $('stBlend').value = L.blend || 'source-over';
    if (isText) {
      $('stText').value = L.text;
      $('stSize').value = L.size; slv('stSizeV', L.size + 'px');
      $('stFont').textContent = L.font === 'serif' ? 'Serif' : 'Sans';
      $('stFont').classList.toggle('on', L.font === 'serif');
      $('stBold').classList.toggle('on', (L.weight || 0) >= 700);
      $('stShadow').classList.toggle('on', !!L.shadow);
      $('stOutline').classList.toggle('on', !!L.outline);
      $('stGlow').classList.toggle('on', !!L.glow);
      $('stTGrad').classList.toggle('on', !!L.tgrad);
      $('stEyedrop').hidden = typeof window.EyeDropper === 'undefined';
      $('stWrap').classList.toggle('on', !!L.wrapf);
      ['L', 'C', 'R'].forEach((a) => $('stAlign' + a).classList.toggle('on', L.align === { L: 'left', C: 'center', R: 'right' }[a]));
    }
    if (L.type === 'rect') {
      $('stShapeRect').classList.toggle('on', L.shape !== 'ellipse');
      $('stShapeEllipse').classList.toggle('on', L.shape === 'ellipse');
      $('stGrad').classList.toggle('on', !!(L.grad && L.grad !== 'none'));
    }
    if (hasColor) renderColorSwatches(L);
    const op = Math.round((L.opacity == null ? 1 : L.opacity) * 100);
    $('stOpacity').value = op; slv('stOpacityV', op + '%');
    $('stRot').value = L.rot || 0; slv('stRotV', (L.rot || 0) + '°');
    $('stLock').textContent = L.locked ? '🔒 Locked' : '🔓 Lock';
    $('stLock').classList.toggle('on', !!L.locked);
    $('stHide').textContent = L.hidden ? '🙈 Hidden' : '👁 Visible';
    if ($('stPasteStyle')) $('stPasteStyle').disabled = !styleClip;
    updateContrast();
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

  // ---- faithful, editable reproductions of the generated graphic styles ------
  const rebuildStyle = (tpl) => {
    inRebuild = true;
    const W = SIZES[sizeKey][0], H = SIZES[sizeKey][1];
    const k = (sizeKey === 'portrait') ? 'square' : sizeKey;   // portrait borrows the square layout, with taller photo metrics
    const port = sizeKey === 'portrait';
    const pIdx = (bg.type === 'photo' && ctxData.photos[bg.photoIndex]) ? bg.photoIndex : 0;   // which photo to feature (carousel edit picks this)
    const b = ctxData.brand, f = ctxData.fields;
    const onP = Visuals.onColor(b.primary);
    const serif = b.font === 'serif', sans = b.font === 'sans';
    const priceFont = (def) => serif ? 'serif' : sans ? 'sans' : def;
    const out = [];
    const measureW = (t, wt, size, fam) => { ctx2d.font = `${wt} ${size}px ${fam === 'serif' ? SERIF : SANS}`; return ctx2d.measureText(String(t)).width; };
    const stripW = (text, size) => { ctx2d.font = `700 ${size}px ${SANS}`; const parts = String(text).split(/[·•|]/).map((s) => s.trim()).filter(Boolean); const padX = size * 0.7, gap = size * 0.45; let tot = 0; parts.forEach((p, k2) => { tot += ctx2d.measureText(p).width + padX * 2; if (k2) tot += gap; }); return tot; };
    const push = (o) => { out.push({ id: uid++, opacity: 1, rot: 0, ...o }); return out[out.length - 1]; };
    const leftText = (t, mpx, baseY, size, o = {}) => { const fam = o.font || 'sans', wt = o.weight || 400; const w = measureW(t, wt, size, fam); return push({ type: 'text', text: String(t), size, weight: wt, font: fam, color: o.color || '#ffffff', align: 'left', shadow: !!o.shadow, xf: (mpx + w / 2) / W, yf: (baseY - size * 0.35) / H }); };
    const ctrText = (t, cxpx, baseY, size, o = {}) => push({ type: 'text', text: String(t), size, weight: o.weight || 400, font: o.font || 'sans', color: o.color || '#ffffff', align: 'center', shadow: !!o.shadow, xf: cxpx / W, yf: (baseY - size * 0.35) / H });
    const badgeTL = (text, xpx, ypx, size, color) => { const bw = measureW(text, 800, size, 'sans') + size * 1.4, bh = size * 1.85; return push({ type: 'badge', text: String(text), size, weight: 800, color, font: 'sans', align: 'center', xf: (xpx + bw / 2) / W, yf: (ypx + bh / 2) / H }); };
    const logoRight = (xRightPx, cyPx, maxH) => {
      const img = b.logoImg; if (!img || !img.width) return;
      const s = Math.min(maxH / img.height, 280 / img.width), lw = img.width * s;
      push({ type: 'image', src: 'logo', shape: 'rect', wf: lw / W, xf: (xRightPx - lw / 2) / W, yf: cyPx / H });
    };
    const brandBarL = (barH) => {
      push({ type: 'rect', shape: 'rect', color: 'primary', wf: 1, hf: barH / H, xf: 0.5, yf: (H - barH / 2) / H, radius: 0, grad: 'none' });
      const pad = barH * 0.36, cy = H - barH / 2;
      const name = b.agentName || 'Your Name Here';
      const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
      leftText(name, pad, cy - (sub ? barH * 0.06 : -barH * 0.1), barH * 0.3, { weight: 700, color: onP });
      if (sub) leftText(sub, pad, cy + barH * 0.27 + barH * 0.11, barH * 0.22, { weight: 400, color: onP });
      let xRight = W - pad;
      if (b.headImg && b.headImg.width) { const dd = barH * 0.62; push({ type: 'image', src: 'head', shape: 'circle', wf: dd / W, xf: (xRight - dd / 2) / W, yf: cy / H }); xRight -= dd + barH * 0.22; }
      logoRight(xRight, cy, barH * 0.52);
    };

    if (tpl === 'modern') {
      bg = ctxData.photos.length ? { type: 'photo', photoIndex: (bg.type === 'photo' ? bg.photoIndex : 0) } : { type: 'color', color: 'primary' };
      push({ type: 'rect', shape: 'rect', color: '#080e12', grad: 'up', wf: 1, hf: 0.6, xf: 0.5, yf: 0.7, opacity: 0.9, radius: 0 });
      const m = k === 'wide' ? 40 : 48, badgeSize = k === 'wide' ? 22 : 28;
      if (f.badge) badgeTL(f.badge, m, m, badgeSize, 'accent');
      const barH = k === 'story' ? 130 : k === 'wide' ? 88 : 110;
      brandBarL(barH);
      const priceSize = k === 'story' ? 96 : k === 'wide' ? 60 : 84, addrSize = k === 'story' ? 40 : k === 'wide' ? 27 : 36, statSize = k === 'story' ? 30 : k === 'wide' ? 21 : 27;
      let y = H - barH - m * 0.8;
      if (f.stats) { leftText(f.stats, m, y, statSize, { weight: 600 }); y -= statSize * 1.7; }
      if (f.address) { leftText(f.address, m, y, addrSize, { weight: 400 }); y -= addrSize * 1.45; }
      if (f.price) leftText(f.price, m, y, priceSize, { weight: 800, font: priceFont('sans') });
    } else if (tpl === 'classic') {
      bg = { type: 'color', color: '#faf7f2' };
      const ink = '#23333b', mut = '#5d6e75', m = 64;
      push({ type: 'rect', shape: 'rect', color: '#faf7f2', noFill: true, stroke: 'accent', strokeWf: 2 / W, wf: (W - 52) / W, hf: (H - 52) / H, xf: 0.5, yf: 0.5, radius: 0 });
      if (k === 'wide') {
        const cX = (W + 640) / 2;
        if (ctxData.photos.length) push({ type: 'photo', photoIndex: pIdx, shape: 'rect', wf: 596 / W, hf: (H - 88) / H, xf: (44 + 298) / W, yf: 0.5 });
        if (f.badge) badgeTL(f.badge, 64, 64, 19, 'accent');
        let y = 175;
        if (f.price) { ctrText(f.price, cX, y + 40, 58, { weight: 700, font: priceFont('serif'), color: b.primary }); y += 95; }
        if (f.address) { ctrText(f.address, cX, y + 10, 26, { weight: 400, color: ink }); y += 52; }
        push({ type: 'rect', shape: 'rect', color: 'accent', wf: 90 / W, hf: 3 / H, xf: cX / W, yf: (y + 1.5) / H, radius: 0 }); y += 45;
        if (f.stats) ctrText(f.stats, cX, y, 21, { weight: 600, color: ink });
        ctrText(b.agentName || 'Your Name Here', cX, H - 124, 24, { weight: 700, color: ink });
        const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
        if (sub) ctrText(sub, cX, H - 88, 19, { weight: 400, color: mut });
      } else {
        const photoW = W - m * 2, mainH = k === 'story' ? 1010 : (port ? Math.round(H * 0.6) : 590);
        if (ctxData.photos.length) push({ type: 'photo', photoIndex: pIdx, shape: 'rect', wf: photoW / W, hf: mainH / H, xf: 0.5, yf: (m + mainH / 2) / H });
        if (f.badge) badgeTL(f.badge, m + 22, m + 22, k === 'story' ? 26 : 22, 'accent');
        let y = m + mainH + (k === 'story' ? 84 : 84);
        if (f.price) { ctrText(f.price, W / 2, y, k === 'story' ? 88 : 72, { weight: 700, font: priceFont('serif'), color: b.primary }); y += 58; }
        if (f.address) { ctrText(f.address, W / 2, y, k === 'story' ? 36 : 31, { weight: 400, color: ink }); y += 52; }
        push({ type: 'rect', shape: 'rect', color: 'accent', wf: 90 / W, hf: 3 / H, xf: 0.5, yf: (y - 14) / H, radius: 0 }); y += 38;
        if (f.stats) ctrText(f.stats, W / 2, y, k === 'story' ? 28 : 24, { weight: 600, color: ink });
        const baseY = H - (k === 'story' ? 120 : 96);
        if (b.headImg && b.headImg.width) push({ type: 'image', src: 'head', shape: 'circle', wf: (k === 'story' ? 120 : 92) / W, xf: 0.5, yf: (baseY - (k === 'story' ? 110 : 88)) / H });
        ctrText(b.agentName || 'Your Name Here', W / 2, baseY, k === 'story' ? 30 : 26, { weight: 700, color: ink });
        const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
        if (sub) ctrText(sub, W / 2, baseY + (k === 'story' ? 38 : 32), k === 'story' ? 24 : 20, { weight: 400, color: mut });
      }
    } else {   // bold
      bg = { type: 'gradient', c1: Visuals.shade(b.primary, 14), c2: Visuals.shade(b.primary, -34), angle: 90 };
      const fg = onP, m = k === 'wide' ? 44 : 48;
      if (k === 'wide') {
        if (ctxData.photos.length) push({ type: 'photo', photoIndex: pIdx, shape: 'rounded', radius: 26, wf: 560 / W, hf: (H - m * 2) / H, xf: (W - 560 - m + 280) / W, yf: 0.5 });
        const cX = m + 12;
        if (f.badge) badgeTL(f.badge, cX, 72, 21, 'accent');
        let y = 250;
        if (f.price) { leftText(f.price, cX, y, 64, { weight: 800, font: priceFont('sans'), color: fg }); y += 52; }
        if (f.address) { leftText(f.address, cX, y, 26, { weight: 400, color: fg }); y += 64; }
        if (f.stats) push({ type: 'statsstrip', text: f.stats, color: 'accent', size: 20, xf: (cX + 150) / W, yf: (y + 20) / H, weight: 700 });
        leftText(b.agentName || 'Your Name Here', cX, H - 108, 24, { weight: 700, color: fg });
        const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
        if (sub) leftText(sub, cX, H - 72, 19, { weight: 400, color: fg });
      } else {
        const photoH = k === 'story' ? 1100 : (port ? Math.round(H * 0.62) : 540);
        if (ctxData.photos.length) push({ type: 'photo', photoIndex: pIdx, shape: 'rounded', radius: 30, wf: (W - m * 2) / W, hf: photoH / H, xf: 0.5, yf: (m + photoH / 2) / H });
        if (f.badge) push({ type: 'badge', text: f.badge, size: k === 'story' ? 30 : 26, weight: 800, color: 'accent', font: 'sans', align: 'center', rot: -8, xf: (m + 90) / W, yf: (m + photoH - 10) / H });
        let y = m + photoH + (k === 'story' ? 150 : 110);
        if (f.price) { leftText(f.price, m + 16, y, k === 'story' ? 104 : 88, { weight: 800, font: priceFont('sans'), color: fg }); y += k === 'story' ? 66 : 56; }
        if (f.address) { leftText(f.address, m + 16, y, k === 'story' ? 38 : 33, { weight: 400, color: fg }); y += k === 'story' ? 84 : 66; }
        if (f.stats) { const ss = k === 'story' ? 26 : 23; push({ type: 'statsstrip', text: f.stats, color: 'accent', size: ss, xf: (m + 16 + stripW(f.stats, ss) / 2) / W, yf: (y + 20) / H, weight: 700 }); }   // left-aligned like the generated bold
        const rowY = H - (k === 'story' ? 150 : 130);
        push({ type: 'rect', shape: 'rect', color: 'accent', wf: (W - (m + 16) * 2) / W, hf: 2 / H, xf: 0.5, yf: rowY / H, radius: 0, opacity: 0.55 });
        leftText(b.agentName || 'Your Name Here', m + 16, rowY + (k === 'story' ? 58 : 50), k === 'story' ? 32 : 28, { weight: 700, color: fg });
        const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
        if (sub) leftText(sub, m + 16, rowY + (k === 'story' ? 96 : 84), k === 'story' ? 24 : 21, { weight: 400, color: fg });
        if (b.headImg && b.headImg.width) push({ type: 'image', src: 'head', shape: 'circle', wf: (k === 'story' ? 110 : 96) / W, xf: (W - m - 16 - 50) / W, yf: (rowY + (k === 'story' ? 72 : 64)) / H });
        else logoRight(W - m - 16, rowY + (k === 'story' ? 72 : 64), k === 'story' ? 80 : 68);
      }
    }
    layers = out; selId = null; bgEdit = false; rebuiltFrom = tpl; renderBgPicker(); commit(); inRebuild = false;
  };

  // ---- faithful carousel-slide reproduction ---------------------------------
  // Rebuilds ONE carousel slide (a feature photo+caption slide, or the closing
  // CTA card) as editable layers that match visuals.js featureSlide/ctaSlide
  // pixel-for-pixel on the 1080² square. The cover slide is just the brand
  // template card, so it routes through rebuildStyle instead (see open()).
  const buildSlide = (slide) => {
    inRebuild = true;
    const W = SIZES.square[0], H = SIZES.square[1];     // carousel slides are always 1080²
    const b = ctxData.brand, f = ctxData.fields;
    const serif = b.font === 'serif';
    const capFont = serif ? 'serif' : 'sans';           // mirrors priceFam(brand, SANS): serif only when brand.font==='serif'
    const out = [];
    const push = (o) => { out.push({ id: uid++, opacity: 1, rot: 0, ...o }); return out[out.length - 1]; };
    const measureW = (t, wt, size, fam) => { ctx2d.font = `${wt} ${size}px ${fam === 'serif' ? SERIF : SANS}`; return ctx2d.measureText(String(t)).width; };
    // text whose alphabetic baseline sits at baseY, anchored left / centre / right
    const leftText = (t, mpx, baseY, size, o = {}) => { const fam = o.font || 'sans', wt = o.weight || 400; const w = measureW(t, wt, size, fam); return push({ type: 'text', text: String(t), size, weight: wt, font: fam, color: o.color || '#ffffff', align: 'left', shadow: !!o.shadow, locked: !!o.locked, tracking: o.tracking || 0, opacity: o.opacity == null ? 1 : o.opacity, xf: (mpx + w / 2) / W, yf: (baseY - size * 0.35) / H }); };
    const rightText = (t, rpx, baseY, size, o = {}) => { const fam = o.font || 'sans', wt = o.weight || 400; const w = measureW(t, wt, size, fam); return push({ type: 'text', text: String(t), size, weight: wt, font: fam, color: o.color || '#ffffff', align: 'right', shadow: !!o.shadow, opacity: o.opacity == null ? 1 : o.opacity, xf: (rpx - w / 2) / W, yf: (baseY - size * 0.35) / H }); };
    const ctrText = (t, cxpx, baseY, size, o = {}) => push({ type: 'text', text: String(t), size, weight: o.weight || 400, font: o.font || 'sans', color: o.color || '#ffffff', align: 'center', shadow: !!o.shadow, tracking: o.tracking || 0, opacity: o.opacity == null ? 1 : o.opacity, xf: cxpx / W, yf: (baseY - size * 0.35) / H });

    if (slide.kind === 'cta') {
      // mirror visuals.ctaSlide(canvas, { brand, address }) — visuals.js:419
      const fg = Visuals.onColor(b.primary);
      bg = { type: 'gradient', c1: Visuals.shade(b.primary, 16), c2: Visuals.shade(b.primary, -32), angle: 90 };
      // decorative ring, centre (960,140) r190 → stroked ellipse @ accent 0.35
      push({ type: 'rect', shape: 'ellipse', noFill: true, stroke: 'accent', strokeWf: 3 / W, color: 'accent', wf: 380 / W, hf: 380 / H, xf: 960 / W, yf: 140 / H, opacity: 0.35, locked: true });
      // headshot (dia 230) OR centred logo (max-h 150) near y=270
      if (b.headImg && b.headImg.width) push({ type: 'image', src: 'head', shape: 'circle', wf: 230 / W, xf: 0.5, yf: 270 / H });
      else if (b.logoImg && b.logoImg.width) { const s = Math.min(150 / b.logoImg.height, 280 / b.logoImg.width), lw = b.logoImg.width * s; push({ type: 'image', src: 'logo', shape: 'rect', wf: lw / W, xf: 0.5, yf: 270 / H }); }
      ctrText('Like what you see?', 540, 460, 66, { weight: 700, font: capFont, color: fg });
      // pill CTA (badge auto-sizes; letter-spacing 4)
      push({ type: 'badge', text: 'BOOK YOUR PRIVATE VIEWING', size: 30, weight: 800, color: 'accent', font: 'sans', align: 'center', tracking: 4, xf: 0.5, yf: (520 + 39) / H });
      ctrText(b.agentName || 'Your Name Here', 540, 708, 40, { weight: 700, color: fg });
      let yy = 708;
      if (b.brokerage) { yy += 48; ctrText(b.brokerage, 540, yy, 28, { weight: 400, color: fg, opacity: 0.85 }); }
      const contact = [b.phone, b.email].filter(Boolean).join('   ·   ');
      if (contact) { yy += 44; ctrText(contact, 540, yy, 28, { weight: 400, color: fg, opacity: 0.85 }); }
      if (f.address) ctrText(String(f.address).toUpperCase(), 540, 1008, 24, { weight: 600, color: 'accent', opacity: 0.95, tracking: 2 });
      layers = out; selId = null; bgEdit = false; rebuiltFrom = null; renderBgPicker(); commit(); inRebuild = false;
      return;
    }

    // ---- feature slide: photo + caption — mirror visuals.featureSlide (visuals.js:378)
    const pIdx = (typeof slide.photoIndex === 'number' && ctxData.photos[slide.photoIndex]) ? slide.photoIndex : 0;
    bg = ctxData.photos.length ? { type: 'photo', photoIndex: pIdx } : { type: 'color', color: 'dark' };
    // bottom legibility gradient: dark, fading up; y 594→1080 reaching alpha 0.85
    push({ type: 'rect', shape: 'rect', color: '#080e12', grad: 'up', wf: 1, hf: 486 / H, xf: 0.5, yf: (594 + 243) / H, opacity: 0.85, radius: 0, locked: true });

    const caption = slide.caption || '';
    if (caption) {
      // replicate wrapText(caption, W-128=952, max 2 lines) to find line count + widest line
      ctx2d.font = `700 46px ${capFont === 'serif' ? SERIF : SANS}`;
      const words = String(caption).split(/\s+/);
      let line = '', lines = [];
      for (const wd of words) {
        const t = line ? line + ' ' + wd : wd;
        if (ctx2d.measureText(t).width > 952 && line) { lines.push(line); line = wd; if (lines.length === 2) break; }
        else line = t;
      }
      if (lines.length < 2 && line) lines.push(line);
      const nLines = Math.max(1, Math.min(2, lines.length));
      let textW = 0; lines.forEach((l) => { textW = Math.max(textW, ctx2d.measureText(l).width); });
      const firstBaseline = 1080 - 96 - (nLines - 1) * 58;   // visuals: y = H-96-(lines-1)*58
      // block centre keeps the codebase's baseline→centre convention (size*0.35) per line
      const blockCentreY = firstBaseline + (nLines - 1) * 29 - 46 * 0.35;
      push({ type: 'text', text: caption, size: 46, weight: 700, font: capFont, color: '#ffffff', align: 'left', wrapf: 952 / W, lineh: 58 / 46, xf: (64 + Math.min(textW, 952) / 2) / W, yf: blockCentreY / H });
      // accent tick: 56×5 bar at (64, firstBaseline-58)
      push({ type: 'rect', shape: 'rect', color: 'accent', wf: 56 / W, hf: 5 / H, xf: (64 + 28) / W, yf: ((firstBaseline - 58) + 2.5) / H, radius: 0, locked: true });
    }

    // footer: agent name (left) + counter (right), 600/24 @ white 0.75
    if (b.agentName) leftText(b.agentName, 64, 1044, 24, { weight: 600, color: 'rgba(255,255,255,0.75)' });
    rightText(`${(slide.idx || 0) + 1}/${slide.total || 1}`, 1028, 1044, 24, { weight: 600, color: 'rgba(255,255,255,0.75)' });

    // position dots, top-right (locked decoration, r6.5, 26px apart)
    const total = slide.total || 1, active = slide.idx || 0;
    for (let i = 0; i < total; i++) {
      push({ type: 'rect', shape: 'ellipse', wf: 13 / W, hf: 13 / H, xf: (1080 - 52 - (total - 1 - i) * 26) / W, yf: 52 / H, color: i === active ? '#ffffff' : 'rgba(255,255,255,0.45)', locked: true });
    }

    layers = out; selId = null; bgEdit = false; rebuiltFrom = null; renderBgPicker(); commit(); inRebuild = false;
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

  // ---- AI auto-layout: map the AI's JSON onto real studio layers -------------
  // The studio is the source of truth: every value is clamped, every colour
  // brand-checked, and all text is bound from the real listing facts (or a
  // fixed label whitelist) — the AI cannot inject a fabricated fact or claim.
  const AI_LABELS = ['FOR SALE', 'FOR LEASE', 'NEW LISTING', 'JUST LISTED', 'HOME OPEN', 'UNDER OFFER', 'SOLD', 'AUCTION', 'EXPRESSIONS OF INTEREST', 'PRICE GUIDE', 'INSPECT', 'CONTACT', 'VIEW NOW', 'ENQUIRE', 'OFFERS FROM'];
  const GRADS = ['none', 'up', 'down', 'left', 'right'];
  const clampN = (v, a, b, d) => { const n = Number(v); return isNaN(n) ? d : Math.max(a, Math.min(b, n)); };
  const okColor = (c, fb) => (['white', 'dark', 'primary', 'accent'].includes(c) || /^#[0-9a-f]{6}$/i.test(c)) ? c : fb;
  const factOf = (ref) => {
    if (!ref) return null;
    if (ctxData.fields[ref] != null && ctxData.fields[ref] !== '') return ctxData.fields[ref];
    if (ctxData.brand[ref] != null && ctxData.brand[ref] !== '') return ctxData.brand[ref];
    return null;
  };
  const mapAILayer = (L) => {
    if (!L || typeof L !== 'object') return null;
    const base = { id: uid++, xf: clampN(L.xf, 0, 1, 0.5), yf: clampN(L.yf, 0, 1, 0.5), opacity: clampN(L.opacity, 0, 1, 1), rot: clampN(L.rot, -180, 180, 0) };
    const t = L.type;
    if (t === 'shape') return { ...base, type: 'rect', shape: L.shape === 'ellipse' ? 'ellipse' : 'rect', color: okColor(L.color, 'primary'), wf: clampN(L.wf, 0.02, 1, 0.5), hf: clampN(L.hf, 0.02, 1, 0.2), radius: clampN(L.radius, 0, 200, 0), grad: GRADS.includes(L.grad) ? L.grad : 'none' };
    if (t === 'scrim') {
      const cover = clampN(L.coverf, 0.1, 1, 0.4);
      const g = { bottom: [0.5, 1 - cover / 2, 1, cover, 'up'], top: [0.5, cover / 2, 1, cover, 'down'], left: [cover / 2, 0.5, cover, 1, 'right'], right: [1 - cover / 2, 0.5, cover, 1, 'left'], full: [0.5, 0.5, 1, 1, 'none'] }[L.edge] || [0.5, 0.84, 1, 0.45, 'up'];
      return { ...base, type: 'rect', shape: 'rect', xf: g[0], yf: g[1], wf: g[2], hf: g[3], grad: g[4], color: okColor(L.color, 'dark'), radius: 0, opacity: clampN(L.strength, 0, 1, 0.55) };
    }
    if (t === 'logo' || t === 'headshot') {
      const src = t === 'logo' ? 'logo' : 'head';
      const img = src === 'logo' ? ctxData.brand.logoImg : ctxData.brand.headImg;
      if (!img || !img.width) return null;
      return { ...base, type: 'image', src, shape: (L.shape === 'circle' || L.shape === 'rect') ? L.shape : (t === 'logo' ? 'rect' : 'circle'), wf: clampN(L.wf, 0.03, 0.6, 0.18) };
    }
    // text-bearing
    let str = null;
    if (t === 'text') { const lit = String(L.text || '').trim().toUpperCase(); if (AI_LABELS.includes(lit)) str = lit; else return null; }
    else if (t === 'agent') str = [ctxData.brand.agentName, ctxData.brand.phone, ctxData.brand.brokerage].filter(Boolean).join('\n') || null;
    else str = factOf(L.textRef);
    if (!str) return null;
    if (L.uppercase) str = String(str).toUpperCase();
    const kind = (t === 'badge' || t === 'text' || L.textRef === 'badge') ? 'badge' : 'text';
    return { ...base, type: kind, text: String(str), size: clampN(L.size, 12, 280, 60), color: okColor(L.color, 'white'), font: L.font === 'serif' ? 'serif' : 'sans', weight: [300, 400, 500, 600, 700, 800, 900].includes(L.weight) ? L.weight : 700, align: ['left', 'center', 'right'].includes(L.align) ? L.align : 'center', shadow: !!L.shadow, outline: !!L.outline, wrapf: (L.wrapf >= 0.2 && L.wrapf <= 1) ? L.wrapf : 0 };
  };
  const mapAIBg = (b) => {
    if (!b || typeof b !== 'object') return { type: 'color', color: ctxData.brand.primary };
    if (b.type === 'photo' && ctxData.photos.length) {
      const idx = clampN(b.photoIndex, 0, ctxData.photos.length - 1, 0) | 0;
      const br = b.filter && b.filter.brightness;
      return { type: 'photo', photoIndex: idx, darken: (br < 0) ? Math.min(0.6, -br / 100 * 0.6) : 0 };
    }
    if (b.type === 'solid') return { type: 'color', color: okColor(b.color, ctxData.brand.primary) };
    if (b.type === 'gradient') return { type: 'gradient', c1: okColor(b.from, ctxData.brand.primary), c2: okColor(b.to, ctxData.brand.accent), angle: clampN(b.angle, 0, 360, 135), radial: b.mode === 'radial' };
    return { type: 'color', color: ctxData.brand.primary };
  };
  // shrink a text/badge layer until it fits the canvas (or its wrap width)
  const fitLayer = (L) => {
    if (!ctx2d || !(L.type === 'text' || L.type === 'badge')) return;
    const target = (L.wrapf ? L.wrapf : 0.92) * W();
    if (measure(L).bw <= target) return;
    let lo = 12, hi = L.size;
    for (let i = 0; i < 22; i++) { const mid = (lo + hi) / 2; L.size = mid; if (measure(L).bw > target) hi = mid; else lo = mid; }
    L.size = Math.max(12, Math.floor(lo));
  };
  // apply a chosen AI design as ONE undoable step; returns false if non-viable
  const applyAIDesign = (d) => {
    if (!d || !Array.isArray(d.layers)) return false;
    const mapped = d.layers.slice(0, 12).map(mapAILayer).filter(Boolean);
    if (!mapped.some((l) => l.type === 'text' || l.type === 'badge')) return false;  // empty/graphic-only → reject
    if (SIZES[d.size]) { sizeKey = d.size; document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x.dataset.size === sizeKey)); }
    mapped.forEach(fitLayer);   // never let AI text overflow the canvas
    bg = mapAIBg(d.background);
    layers = mapped; selId = null; renderBgPicker(); commit();
    return true;
  };

  let aiVariations = [];
  const aiStatus = (msg, kind) => { const e = $('stAiStatus'); if (!e) return; e.hidden = !msg; e.textContent = msg || ''; e.className = 'st-ai-status' + (kind ? ' ' + kind : ''); };
  const renderAiPicker = () => {
    const box = $('stAiPicker'); if (!box) return;
    box.innerHTML = ''; box.hidden = !aiVariations.length;
    aiVariations.forEach((d, i) => {
      const b = document.createElement('button'); b.className = 'st-ai-opt';
      const name = document.createElement('span'); name.textContent = (d.name || ('Design ' + (i + 1)));
      const why = document.createElement('small'); why.textContent = String(d.rationale || '').slice(0, 140);
      b.append(name, why);
      b.addEventListener('click', () => { if (applyAIDesign(d)) aiStatus('Applied — tweak anything, or Undo (⌘Z) to revert.'); else aiStatus('That option didn’t pass checks — try another or Regenerate.', 'err'); });
      box.appendChild(b);
    });
    if (aiVariations.length) { const r = document.createElement('button'); r.className = 'st-ai-regen'; r.textContent = '↻ Regenerate'; r.addEventListener('click', runAi); box.appendChild(r); }
  };
  const runAi = async () => {
    if (typeof AI === 'undefined' || !AI.available()) { aiStatus('Add your Anthropic API key in “Your brand” (close the studio first) to use AI design.', 'err'); return; }
    const btn = $('stAiGen'); btn.disabled = true; btn.textContent = '…';
    aiVariations = []; renderAiPicker();
    let secs = 0; aiStatus('Designing…');
    const tick = setInterval(() => { secs++; aiStatus(`Designing… ${secs}s (usually 10–25s)`); }, 1000);
    try {
      const dims = SIZES[sizeKey];
      aiVariations = await AI.designLayout({
        size: sizeKey, w: dims[0], h: dims[1], n: 3, vibe: $('stAiVibe').value.trim(),
        photoCount: ctxData.photos.length, facts: ctxData.fields, brand: ctxData.brand,
        hasLogo: !!(ctxData.brand.logoImg && ctxData.brand.logoImg.width), hasHead: !!(ctxData.brand.headImg && ctxData.brand.headImg.width),
      });
      clearInterval(tick);
      aiStatus(`✓ ${aiVariations.length} design${aiVariations.length === 1 ? '' : 's'} — tap one to apply.`);
      renderAiPicker();
    } catch (e) {
      clearInterval(tick);
      aiStatus(typeof AI !== 'undefined' && AI.explain ? AI.explain(e) : 'AI design failed — try again.', 'err');
    } finally { btn.disabled = false; btn.textContent = 'Generate'; }
  };
  const resetAi = () => { aiVariations = []; renderAiPicker(); aiStatus(''); if ($('stAiVibe')) $('stAiVibe').value = ''; };

  // ---- quick actions: place on canvas, fit text, copy-to-clipboard, eyedropper
  const alignTo = (dir) => {
    const L = sel(); if (!L || !L._c) return;
    const w = W(), h = H(), m = 0.04;
    const hw = L._c.w / 2 + L._c.pad, hh = L._c.h / 2 + L._c.pad;
    if (dir === 'l') L.xf = (m * w + hw) / w; else if (dir === 'cx') L.xf = 0.5; else if (dir === 'r') L.xf = (w - m * w - hw) / w;
    else if (dir === 't') L.yf = (m * h + hh) / h; else if (dir === 'cy') L.yf = 0.5; else if (dir === 'b') L.yf = (h - m * h - hh) / h;
    commit();
  };
  const fitSel = () => { const L = sel(); if (L) { fitLayer(L); commit(); } };
  const flashBtn = (id, txt, ms) => { const b = $(id); if (!b) return; const o = b.textContent; b.textContent = txt; setTimeout(() => { b.textContent = o; }, ms || 1400); };
  const copyImage = async () => {
    render(false);
    try {
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); flashBtn('stCopyImg', '✓ Copied'); }
      else { exportImage('image/png'); flashBtn('stCopyImg', '↓ Downloaded'); }   // clipboard image unsupported (e.g. Firefox)
    } catch (e) { try { exportImage('image/png'); flashBtn('stCopyImg', '↓ Downloaded'); } catch (e2) {} }
    finally { render(true); }
  };
  const eyedrop = () => { const L = sel(); if (!L || typeof window.EyeDropper === 'undefined') return; new window.EyeDropper().open().then((r) => setColor(L, r.sRGBHex)).catch(() => {}); };

  // copy / paste a layer's look (format painter) — visual style keys only
  let styleClip = null;
  const STYLE_KEYS = ['color', 'font', 'weight', 'align', 'shadow', 'outline', 'glow', 'glowColor', 'tgrad', 'stroke', 'wrapf', 'opacity', 'rot', 'tracking', 'lineh', 'blend'];
  const copyStyle = () => { const L = sel(); if (!L) return; styleClip = {}; STYLE_KEYS.forEach((k) => { if (L[k] !== undefined) styleClip[k] = JSON.parse(JSON.stringify(L[k])); }); if ($('stPasteStyle')) $('stPasteStyle').disabled = false; };
  const pasteStyle = () => { const L = sel(); if (!L || !styleClip) return; Object.keys(styleClip).forEach((k) => { L[k] = JSON.parse(JSON.stringify(styleClip[k])); }); commit(); };

  // legibility checker — warn when a text layer is low-contrast against what's behind it
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const relLum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const hexLum = (hex) => { const h = (hex || '#000').replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16); return relLum((n >> 16) & 255, (n >> 8) & 255, n & 255); };
  const updateContrast = () => {
    const box = $('stContrast'); if (!box) return;
    const L = sel();
    if (!L || L.type !== 'text' || !L._c || L._c.w < 2) { box.hidden = true; return; }
    let bgLum;
    try {
      const x0 = Math.max(0, Math.round(L._c.cx - L._c.w / 2)), y0 = Math.max(0, Math.round(L._c.cy - L._c.h / 2));
      const ww = Math.max(2, Math.min(W() - x0, Math.round(L._c.w))), hh = Math.max(2, Math.min(H() - y0, Math.round(L._c.h)));
      const d = ctx2d.getImageData(x0, y0, ww, hh).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      bgLum = relLum(r / n, g / n, b / n);
    } catch (e) { box.hidden = true; return; }   // tainted canvas → skip silently
    const tLum = hexLum(resolveColor(L.color));
    const ratio = (Math.max(bgLum, tLum) + 0.05) / (Math.min(bgLum, tLum) + 0.05);
    if (ratio >= 3) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '⚠ This text may be hard to read here. <button type="button" id="stContrastFix">Add shadow + outline</button>';
    $('stContrastFix').addEventListener('click', () => { L.shadow = true; L.outline = true; commit(); });
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

  // ---- upload a photo from inside the studio --------------------------------
  // Uses the app's addPhoto callback (persists to the listing gallery) when
  // provided; falls back to a studio-local load so it always works.
  const loadLocalPhoto = (file) => new Promise((res) => {
    const r = new FileReader();
    r.onload = () => { const img = new Image(); img.onload = () => res({ url: r.result, img, focus: 'center', filter: { b: 100, c: 100, s: 100, w: 0 } }); img.onerror = () => res(null); img.src = r.result; };
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  });
  const uploadFiles = async (files) => {
    let last = -1;
    for (const file of files) {
      let p = null;
      if (ctxData.addPhoto) { try { p = await ctxData.addPhoto(file); } catch (e) { p = null; } }
      if (!p) p = await loadLocalPhoto(file);
      if (!p) continue;
      if (!ctxData.photos.includes(p)) ctxData.photos.push(p);
      last = ctxData.photos.indexOf(p);
    }
    if (last >= 0) { bg = { type: 'photo', photoIndex: last, darken: 0 }; renderBgPicker(); commit(); }
  };

  // ---- open / wire -----------------------------------------------------------
  let wired = false;
  const wire = () => {
    if (wired) return; wired = true;
    cv = $('stCanvas'); ctx2d = cv.getContext('2d');
    cv.addEventListener('mousedown', onDown); window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    cv.addEventListener('dblclick', onDblClick);
    cv.addEventListener('touchstart', onDown, { passive: false }); cv.addEventListener('touchmove', onMove, { passive: false }); cv.addEventListener('touchend', onUp);
    document.querySelectorAll('#stSizes button').forEach((b) => b.addEventListener('click', () => { sizeKey = b.dataset.size; document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x === b)); if (rebuiltFrom) rebuildStyle(rebuiltFrom); else commit(); }));
    document.querySelectorAll('#stAdd button').forEach((b) => b.addEventListener('click', () => add(b.dataset.add)));
    document.querySelectorAll('#stStarters button').forEach((b) => b.addEventListener('click', () => applyStarter(b.dataset.tpl)));
    document.querySelectorAll('#stRebuild button').forEach((b) => b.addEventListener('click', () => rebuildStyle(b.dataset.style)));
    $('stAiGen').addEventListener('click', runAi);
    $('stAiVibe').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runAi(); } });

    // background: upload, gradient/solid, darken
    $('stUpload').addEventListener('change', (e) => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) uploadFiles(files); });
    const customGrad = () => ({ type: 'gradient', c1: $('stBgC1').value, c2: $('stBgC2').value, angle: Number($('stBgAngle').value) || 0, radial: !!(bg.type === 'gradient' && bg.radial) });
    $('stBgC1').addEventListener('input', () => { bg = customGrad(); render(); });
    $('stBgC2').addEventListener('input', () => { bg = customGrad(); render(); });
    $('stBgC1').addEventListener('change', () => { bg = customGrad(); renderBgPicker(); commit(); });
    $('stBgC2').addEventListener('change', () => { bg = customGrad(); renderBgPicker(); commit(); });
    $('stBgAngle').addEventListener('input', () => { bg = customGrad(); slv('stBgAngleV', $('stBgAngle').value + '°'); render(); });
    $('stBgAngle').addEventListener('change', () => { bg = customGrad(); renderBgPicker(); commit(); });
    $('stBgRadial').addEventListener('click', () => { bg = { ...customGrad(), radial: !(bg.type === 'gradient' && bg.radial) }; renderBgPicker(); commit(); });
    $('stBgSolid').addEventListener('click', () => { bg = { type: 'color', color: $('stBgC1').value }; renderBgPicker(); commit(); });
    $('stBgDarken').addEventListener('input', () => { if (bg.type === 'photo') { bg.darken = Number($('stBgDarken').value) / 100; slv('stBgDarkenV', $('stBgDarken').value + '%'); render(); } });
    $('stBgDarken').addEventListener('change', () => { if (bg.type === 'photo') commit(); });
    $('stBgDarkenR').addEventListener('click', () => { if (bg.type === 'photo') { bg.darken = 0; renderBgPicker(); commit(); } });

    // photo editing — applies to the selected photo LAYER or the BACKGROUND (bgEdit)
    $('stBgEdit').addEventListener('click', () => { if (bg.type !== 'photo') return; bgEdit = true; selId = null; bg.filter = bg.filter || {}; render(); syncPanel(); renderLayersPanel(); revealPhotoControls(); });
    $('stBgApplyAll').addEventListener('click', () => { if (bgEdit && bg.type === 'photo' && ctxData.onApplyPhotoAdjust) ctxData.onApplyPhotoAdjust(bg.photoIndex, bg.filter || {}); });
    const ph = (fn) => () => { const t = photoT(); if (t) fn(t); };
    const phShape = (s) => ph((t) => { if (t !== bg) { t.shape = s; commit(); } });
    $('stPhRect').addEventListener('click', phShape('rect'));
    $('stPhRound').addEventListener('click', phShape('rounded'));
    $('stPhCircle').addEventListener('click', phShape('circle'));
    $('stPhRadius').addEventListener('input', ph((t) => { if (t !== bg) { t.radius = Number($('stPhRadius').value); slv('stPhRadiusV', t.radius + ''); render(); } }));
    $('stPhRadius').addEventListener('change', commit);
    const phFilter = (id, key, suf) => { const live = ph((t) => { t.filter = t.filter || {}; t.filter[key] = Number($(id).value); slv(id + 'V', $(id).value + suf); render(); }); $(id).addEventListener('input', live); $(id).addEventListener('change', commit); };
    phFilter('stPhB', 'b', '%'); phFilter('stPhC', 'c', '%'); phFilter('stPhS', 's', '%'); phFilter('stPhHue', 'h', '°'); phFilter('stPhSep', 'sep', '%');
    phFilter('stPhHi', 'highlights', ''); phFilter('stPhSh', 'shadows', ''); phFilter('stPhTint', 'tint', ''); phFilter('stPhSharp', 'sharpness', ''); phFilter('stPhVig', 'vignette', '');
    // crop / position (background only)
    // crop: zoom keeps the current view centred; Pan X/Y move the visible-centre point.
    const cropLive = (id, apply, suf) => { const live = ph((t) => { if (!(t === bg || t.hf)) return; ensureCropCenter(t); apply(t, Number($(id).value)); slv(id + 'V', $(id).value + suf); render(); }); $(id).addEventListener('input', live); $(id).addEventListener('change', commit); };
    cropLive('stPhZoom', (t, v) => { t.crop.zoom = v / 100; }, '%');
    cropLive('stPhPanX', (t, v) => { t.crop.cx = 0.5 + v / 200; }, '');
    cropLive('stPhPanY', (t, v) => { t.crop.cy = 0.5 + v / 200; }, '');
    $('stPhReset').addEventListener('click', ph((t) => { t.filter = (t === bg) ? {} : { b: 100, c: 100, s: 100, h: 0, sep: 0, blur: 0 }; t.crop = { zoom: 1 }; commit(); }));

    const cur = () => sel();
    $('stText').addEventListener('input', () => { const L = cur(); if (L) { L.text = $('stText').value; L.edited = true; render(); renderLayersPanel(); } });
    $('stText').addEventListener('change', commit);
    $('stSize').addEventListener('input', () => { const L = cur(); if (L) { L.size = Number($('stSize').value); slv('stSizeV', L.size + 'px'); render(); } });
    $('stSize').addEventListener('change', commit);
    $('stOpacity').addEventListener('input', () => { const L = cur(); if (L) { const v = snapTo(Number($('stOpacity').value), [0, 25, 50, 75, 100], 3); $('stOpacity').value = v; L.opacity = v / 100; slv('stOpacityV', v + '%'); render(); } });
    $('stOpacity').addEventListener('change', commit);
    $('stOpacity').addEventListener('dblclick', () => { const L = cur(); if (L) { L.opacity = 1; commit(); } });
    $('stOpacityR').addEventListener('click', () => { const L = cur(); if (L) { L.opacity = 1; commit(); } });
    // no angle snapping — allow any slight tilt (e.g. 2–3°). Use the ↺ reset or double-click for exactly level.
    $('stRot').addEventListener('input', () => { const L = cur(); if (L) { const v = Number($('stRot').value); L.rot = v; slv('stRotV', v + '°'); render(); } });
    $('stRot').addEventListener('change', commit);
    $('stRot').addEventListener('dblclick', () => { const L = cur(); if (L) { L.rot = 0; commit(); } });
    $('stRotR').addEventListener('click', () => { const L = cur(); if (L) { L.rot = 0; commit(); } });
    $('stTrack').addEventListener('input', () => { const L = cur(); if (L) { L.tracking = Number($('stTrack').value); slv('stTrackV', L.tracking + 'px'); render(); } });
    $('stTrack').addEventListener('change', commit);
    $('stLineh').addEventListener('input', () => { const L = cur(); if (L) { L.lineh = Number($('stLineh').value) / 100; slv('stLinehV', $('stLineh').value + '%'); render(); } });
    $('stLineh').addEventListener('change', commit);
    $('stBlend').addEventListener('change', () => { const L = cur(); if (L) { L.blend = $('stBlend').value; commit(); } });
    $('stFont').addEventListener('click', () => { const L = cur(); if (L) { L.font = L.font === 'serif' ? 'sans' : 'serif'; commit(); } });
    $('stBold').addEventListener('click', () => { const L = cur(); if (L) { L.weight = (L.weight || 0) >= 700 ? 400 : 800; commit(); } });
    $('stShadow').addEventListener('click', () => { const L = cur(); if (L) { L.shadow = !L.shadow; commit(); } });
    $('stOutline').addEventListener('click', () => { const L = cur(); if (L) { L.outline = !L.outline; commit(); } });
    $('stGlow').addEventListener('click', () => { const L = cur(); if (L) { L.glow = !L.glow; commit(); } });
    $('stTGrad').addEventListener('click', () => { const L = cur(); if (L) { if (L.tgrad) L.tgrad = null; else L.tgrad = [L.color, Visuals.shade(resolveColor(L.color), 40)]; commit(); } });
    $('stCopyStyle').addEventListener('click', copyStyle);
    $('stPasteStyle').addEventListener('click', pasteStyle);
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
    $('stCopyImg').addEventListener('click', copyImage);
    $('stFit').addEventListener('click', fitSel);
    $('stEyedrop').addEventListener('click', eyedrop);
    [['stPlL', 'l'], ['stPlCx', 'cx'], ['stPlR', 'r'], ['stPlT', 't'], ['stPlCy', 'cy'], ['stPlB', 'b']].forEach(([id, d]) => $(id).addEventListener('click', () => alignTo(d)));
    $('stClose').addEventListener('click', tryClose);
    // the on-canvas "Crop the photo" button: enter background-edit and jump to the crop controls
    $('stCropFab').addEventListener('click', () => {
      if (bg.type !== 'photo') return;
      bgEdit = true; selId = null; bg.filter = bg.filter || {};
      render(); syncPanel(); renderLayersPanel(); revealPhotoControls();
    });
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
  };

  let lastFocus = null;
  const open = (data, startSize) => {
    wire();
    ctxData = data;
    // read the previous session BEFORE seeding overwrites it (seeding autosaves)
    const wip = loadWip();
    sizeKey = startSize && SIZES[startSize] ? startSize : 'square';
    document.querySelectorAll('#stSizes button').forEach((x) => x.classList.toggle('active', x.dataset.size === sizeKey));
    const startIdx = (typeof ctxData.startPhotoIndex === 'number' && ctxData.photos[ctxData.startPhotoIndex]) ? ctxData.startPhotoIndex : 0;
    const seed = ctxData.seed;
    const ctaSeed = seed === 'cta', featureSeed = seed === 'feature';
    // CTA card edits open on a brand-colour bg; feature/cover edits feature the slide's photo
    bg = ctaSeed ? { type: 'color', color: 'primary' } : (ctxData.photos.length ? { type: 'photo', photoIndex: startIdx } : { type: 'color' });
    layers = []; selId = null;
    replaying = true;            // seed starter layers without touching history / autosave
    if (ctaSeed) {
      // faithfully reproduce the closing CTA carousel slide
      buildSlide({ kind: 'cta' });
    } else if (featureSeed) {
      // faithfully reproduce the clicked photo+caption carousel slide
      buildSlide({ kind: 'feature', photoIndex: startIdx, caption: ctxData.caption || '', idx: ctxData.idx || 0, total: ctxData.total || 1 });
    } else {
      // cover slide / default: reproduce the brand's chosen graphic style as editable layers
      rebuildStyle(ctxData.brand.templateId || 'modern');
    }
    replaying = false;
    selId = null;
    $('stAddLogo').disabled = !(ctxData.brand.logoImg && ctxData.brand.logoImg.width);
    $('stAddHead').disabled = !(ctxData.brand.headImg && ctxData.brand.headImg.width);
    renderBgPicker(); renderTplList(); render(); syncPanel(); renderLayersPanel();
    resetHistory(); dirty = false; guides = []; bgEdit = false;
    $('stCheats').hidden = true;
    resetAi();
    // offer to restore the previous unsaved session if it's the same listing
    $('stRestore').hidden = !(wip && wip.layers && wip.layers.length && wip.addr === addrKey());
    $('studio').hidden = false;
    document.body.style.overflow = 'hidden';
    lastFocus = document.activeElement;
    setTimeout(() => { const b = $('stUndo'); if (b) b.focus(); }, 30);
  };
  const tryClose = () => close();   // no nag — work is autosaved; we just hint that it can be restored
  const close = () => {
    const wasDirty = dirty;
    $('studio').hidden = true; document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
    if (ctxData && ctxData.onClose) { try { ctxData.onClose(wasDirty); } catch (e) {} }
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
