/* Listing Kit — social graphics renderer (v2).
 *
 * Composites listing photos + the agent's saved brand kit into ready-to-post
 * images on <canvas>: Instagram post (1080×1080), Instagram story (1080×1920),
 * and Facebook/link (1200×630). Three design templates (modern / classic /
 * bold), all driven by the brand's primary + accent colors so every export
 * matches the agent's identity. 100% client-side; photos never leave the
 * browser, and exports are real PNGs via canvas.toBlob.
 */
const Visuals = (() => {
  'use strict';

  // ---- color utils -----------------------------------------------------------
  const hexRgb = (h) => {
    h = String(h || '#0f2e3d').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const shade = (hex, amt) => {
    const [r, g, b] = hexRgb(hex);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  };
  const isLight = (hex) => {
    const [r, g, b] = hexRgb(hex);
    return 0.299 * r + 0.587 * g + 0.114 * b > 160;
  };
  const onColor = (hex) => (isLight(hex) ? '#1c2b30' : '#ffffff');
  const alpha = (hex, a) => {
    const [r, g, b] = hexRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  };

  const SANS = `-apple-system, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif`;
  const SERIF = `Georgia, 'Times New Roman', serif`;
  const font = (weight, size, family = SANS) => `${weight} ${size}px ${family}`;

  const spacing = (ctx, px) => { try { ctx.letterSpacing = px + 'px'; } catch (e) {} };

  // ---- drawing helpers -------------------------------------------------------
  const rr = (ctx, x, y, w, h, r) => {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // cover-fit an image into a rect (optionally rounded); placeholder if no img.
  const cover = (ctx, img, x, y, w, h, r, brand) => {
    ctx.save();
    if (r) { rr(ctx, x, y, w, h, r); ctx.clip(); }
    else { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
    if (img && img.width) {
      const s = Math.max(w / img.width, h / img.height);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      const g = ctx.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, shade(brand.primary, 26));
      g.addColorStop(1, shade(brand.primary, -22));
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + w * (0.15 + i * 0.18), y + h * (i % 2 ? 0.3 : 0.72), Math.min(w, h) * 0.16, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.font = `${Math.min(w, h) * 0.22}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🏡', x + w / 2, y + h / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  };

  // pill badge; returns its width
  const badge = (ctx, x, y, text, bg, fg, size = 28, r = 999) => {
    ctx.font = font(800, size);
    spacing(ctx, size * 0.18);
    const padX = size * 0.85, padY = size * 0.52;
    const w = ctx.measureText(text).width + padX * 2;
    const h = size + padY * 2;
    ctx.fillStyle = bg;
    rr(ctx, x, y, w, h, r === 999 ? h / 2 : r);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + h / 2 + size * 0.06);
    ctx.textBaseline = 'alphabetic';
    spacing(ctx, 0);
    return { w, h };
  };

  // outlined stat chip; returns width
  const chip = (ctx, x, y, text, stroke, fg, size = 26) => {
    ctx.font = font(700, size);
    const padX = size * 0.7, h = size * 2;
    const w = ctx.measureText(text).width + padX * 2;
    ctx.strokeStyle = stroke; ctx.lineWidth = 2.5;
    rr(ctx, x, y, w, h, h / 2);
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + h / 2 + size * 0.05);
    ctx.textBaseline = 'alphabetic';
    return { w, h };
  };

  const circleImg = (ctx, img, cx, cy, d, ringColor) => {
    if (!img || !img.width) return false;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, d / 2, 0, Math.PI * 2); ctx.clip();
    const s = Math.max(d / img.width, d / img.height);
    ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
    ctx.restore();
    if (ringColor) { ctx.beginPath(); ctx.arc(cx, cy, d / 2 + 1.5, 0, Math.PI * 2); ctx.strokeStyle = ringColor; ctx.lineWidth = 3; ctx.stroke(); }
    return true;
  };

  const logoImg = (ctx, img, xRight, cy, maxH) => {
    if (!img || !img.width) return 0;
    const s = Math.min(maxH / img.height, 280 / img.width);
    const w = img.width * s, h = img.height * s;
    ctx.drawImage(img, xRight - w, cy - h / 2, w, h);
    return w;
  };

  // brand bar across the bottom; returns its height
  const brandBar = (ctx, W, H, brand, h) => {
    const bg = brand.primary, fg = onColor(bg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, H - h, W, h);
    const pad = h * 0.36, cy = H - h / 2;
    ctx.fillStyle = fg;
    ctx.font = font(700, h * 0.3);
    const name = brand.agentName || 'Your Name Here';
    ctx.fillText(name, pad, cy - (brand.brokerage || brand.phone ? h * 0.06 : -h * 0.1));
    const sub = [brand.brokerage, brand.phone].filter(Boolean).join('  ·  ');
    if (sub) {
      ctx.globalAlpha = 0.82;
      ctx.font = font(400, h * 0.22);
      ctx.fillText(sub, pad, cy + h * 0.27);
      ctx.globalAlpha = 1;
    }
    // right side: headshot circle, then logo to its left
    let xRight = W - pad;
    if (brand.headImg && brand.headImg.width) {
      const d = h * 0.62;
      circleImg(ctx, brand.headImg, xRight - d / 2, cy, d, alpha('#ffffff', 0.85));
      xRight -= d + h * 0.22;
    }
    logoImg(ctx, brand.logoImg, xRight, cy, h * 0.52);
    return h;
  };

  const statText = (d) => {
    const p = [];
    if (d.beds) p.push(`${d.beds} BD`);
    if (d.baths) p.push(`${d.baths} BA`);
    if (d.sqft) p.push(`${d.sqft} SQ FT`);
    return p.join('   ·   ');
  };

  // =====================  MODERN — full-bleed photo + gradient  ================
  const modern = (ctx, W, H, d, kind) => {
    const b = d.brand;
    cover(ctx, d.hero, 0, 0, W, H, 0, b);

    // legibility gradients
    let g = ctx.createLinearGradient(0, H * 0.4, 0, H);
    g.addColorStop(0, 'rgba(8,14,18,0)');
    g.addColorStop(1, 'rgba(8,14,18,0.9)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.4, W, H * 0.6);
    g = ctx.createLinearGradient(0, 0, 0, 170);
    g.addColorStop(0, 'rgba(8,14,18,0.4)'); g.addColorStop(1, 'rgba(8,14,18,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 170);

    const m = kind === 'wide' ? 40 : 48;
    const bd = badge(ctx, m, m, d.badgeText, b.accent, onColor(b.accent), kind === 'wide' ? 22 : 28);
    if (d.ohLine) {
      ctx.font = font(600, kind === 'wide' ? 20 : 26);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(d.ohLine, m + 4, m + bd.h + (kind === 'wide' ? 30 : 38));
    }

    const barH = kind === 'story' ? 130 : kind === 'wide' ? 88 : 110;
    brandBar(ctx, W, H, b, barH);

    // bottom-anchored content
    const priceSize = kind === 'story' ? 96 : kind === 'wide' ? 60 : 84;
    const addrSize = kind === 'story' ? 40 : kind === 'wide' ? 27 : 36;
    const statSize = kind === 'story' ? 30 : kind === 'wide' ? 21 : 27;
    let y = H - barH - m * 0.8;
    const stats = statText(d);
    if (stats) {
      ctx.font = font(600, statSize); spacing(ctx, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(stats, m, y); spacing(ctx, 0);
      y -= statSize * 1.7;
    }
    if (d.address) {
      ctx.font = font(400, addrSize);
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.fillText(d.address, m, y);
      y -= addrSize * 1.45;
    }
    if (d.price) {
      ctx.font = font(800, priceSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(d.price, m, y);
    }
  };

  // =====================  CLASSIC — framed, editorial, serif  =================
  const classic = (ctx, W, H, d, kind) => {
    const b = d.brand;
    const ink = '#23333b', mut = '#5d6e75';
    ctx.fillStyle = '#faf7f2';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = b.accent; ctx.lineWidth = 2;
    ctx.strokeRect(26, 26, W - 52, H - 52);

    const m = 64;
    const centerX = kind === 'wide' ? (W + 640) / 2 : W / 2;

    if (kind === 'wide') {
      // photo left, content right
      cover(ctx, d.hero, 44, 44, 596, H - 88, 0, b);
      badge(ctx, 64, 64, d.badgeText, b.accent, onColor(b.accent), 19, 4);
      ctx.textAlign = 'center';
      let y = d.ohLine ? 150 : 175;
      if (d.ohLine) { ctx.font = font(600, 22); ctx.fillStyle = mut; ctx.fillText(d.ohLine, centerX, 120); }
      if (d.price) { ctx.font = font(700, 58, SERIF); ctx.fillStyle = b.primary; ctx.fillText(d.price, centerX, y + 40); y += 95; }
      if (d.address) { ctx.font = font(400, 26); ctx.fillStyle = ink; ctx.fillText(d.address, centerX, y + 10); y += 52; }
      ctx.fillStyle = b.accent; ctx.fillRect(centerX - 45, y, 90, 3); y += 45;
      const stats = statText(d);
      if (stats) { ctx.font = font(600, 21); spacing(ctx, 4); ctx.fillStyle = ink; ctx.fillText(stats, centerX, y); spacing(ctx, 0); }
      ctx.font = font(700, 24); ctx.fillStyle = ink;
      ctx.fillText(b.agentName || 'Your Name Here', centerX, H - 124);
      const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
      if (sub) { ctx.font = font(400, 19); ctx.fillStyle = mut; ctx.fillText(sub, centerX, H - 88); }
      ctx.textAlign = 'left';
      return;
    }

    // square / story: photo on top, content below
    const photoW = W - m * 2;
    const thumbs = (d.photos || []).length >= 3;
    const mainH = kind === 'story' ? (thumbs ? 880 : 1010) : (thumbs ? 500 : 590);
    cover(ctx, d.hero, m, m, photoW, mainH, 0, b);
    badge(ctx, m + 22, m + 22, d.badgeText, b.accent, onColor(b.accent), kind === 'story' ? 26 : 22, 4);
    let y = m + mainH;
    if (thumbs) {
      const tw = (photoW - 14) / 2, th = kind === 'story' ? 240 : 168;
      cover(ctx, d.photos[1] && d.photos[1].img, m, y + 14, tw, th, 0, b);
      cover(ctx, d.photos[2] && d.photos[2].img, m + tw + 14, y + 14, tw, th, 0, b);
      y += 14 + th;
    }

    ctx.textAlign = 'center';
    const compact = kind === 'square' && thumbs;
    y += compact ? 64 : 84;
    if (d.ohLine) { ctx.font = font(600, compact ? 22 : 26); ctx.fillStyle = mut; ctx.fillText(d.ohLine, W / 2, y - (compact ? 36 : 46)); }
    if (d.price) { ctx.font = font(700, compact ? 60 : kind === 'story' ? 88 : 72, SERIF); ctx.fillStyle = b.primary; ctx.fillText(d.price, W / 2, y); y += compact ? 46 : 58; }
    if (d.address) { ctx.font = font(400, compact ? 27 : kind === 'story' ? 36 : 31); ctx.fillStyle = ink; ctx.fillText(d.address, W / 2, y); y += compact ? 40 : 52; }
    if (!compact) { ctx.fillStyle = b.accent; ctx.fillRect(W / 2 - 45, y - 14, 90, 3); y += 38; }
    const stats = statText(d);
    if (stats) { ctx.font = font(600, compact ? 22 : kind === 'story' ? 28 : 24); spacing(ctx, 5); ctx.fillStyle = ink; ctx.fillText(stats, W / 2, y); spacing(ctx, 0); }

    // contact block pinned to the bottom
    const baseY = H - (kind === 'story' ? 120 : 96);
    if (!compact && b.headImg && b.headImg.width) circleImg(ctx, b.headImg, W / 2, baseY - (kind === 'story' ? 110 : 88), kind === 'story' ? 120 : 92, b.accent);
    ctx.font = font(700, kind === 'story' ? 30 : 26); ctx.fillStyle = ink;
    ctx.fillText(b.agentName || 'Your Name Here', W / 2, baseY);
    const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
    if (sub) { ctx.font = font(400, kind === 'story' ? 24 : 20); ctx.fillStyle = mut; ctx.fillText(sub, W / 2, baseY + (kind === 'story' ? 38 : 32)); }
    ctx.textAlign = 'left';
  };

  // =====================  BOLD — color-block, chips, big type  =================
  const bold = (ctx, W, H, d, kind) => {
    const b = d.brand;
    const fg = onColor(b.primary);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(b.primary, 14));
    g.addColorStop(1, shade(b.primary, -34));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const m = kind === 'wide' ? 44 : 48;
    let contentX = m + 16, contentW = W - m * 2;
    let y;

    if (kind === 'wide') {
      cover(ctx, d.hero, W - 560 - m, m, 560, H - m * 2, 26, b);
      contentX = m + 12; contentW = W - 560 - m * 2 - 40;
      badge(ctx, contentX, 72, d.badgeText, b.accent, onColor(b.accent), 21);
      if (d.ohLine) { ctx.font = font(600, 20); ctx.fillStyle = alpha('#ffffff', 0.9); ctx.fillText(d.ohLine, contentX + 4, 148); }
      y = 250;
      if (d.price) { ctx.font = font(800, 64); ctx.fillStyle = fg; ctx.fillText(d.price, contentX, y); y += 52; }
      if (d.address) { ctx.font = font(400, 26); ctx.fillStyle = alpha(fg === '#ffffff' ? '#ffffff' : '#1c2b30', 0.85); ctx.fillText(d.address, contentX, y); y += 64; }
      let cx = contentX;
      [d.beds && `${d.beds} BD`, d.baths && `${d.baths} BA`, d.sqft && `${d.sqft} SF`].filter(Boolean).forEach((t) => {
        cx += chip(ctx, cx, y, t, b.accent, fg, 20).w + 12;
      });
      ctx.font = font(700, 24); ctx.fillStyle = fg;
      ctx.fillText(b.agentName || 'Your Name Here', contentX, H - 108);
      const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
      if (sub) { ctx.globalAlpha = 0.8; ctx.font = font(400, 19); ctx.fillText(sub, contentX, H - 72); ctx.globalAlpha = 1; }
      return;
    }

    // square / story
    const photoH = kind === 'story' ? 900 : 540;
    cover(ctx, d.hero, m, m, W - m * 2, photoH, 30, b);
    // angled badge overlapping the photo's bottom edge
    ctx.save();
    ctx.translate(m + 16, m + photoH - 26);
    ctx.transform(1, 0, -0.14, 1, 0, 0);
    badge(ctx, 0, 0, d.badgeText, b.accent, onColor(b.accent), kind === 'story' ? 30 : 26, 10);
    ctx.restore();

    y = m + photoH + (kind === 'story' ? 130 : 110);
    if (d.ohLine) { ctx.font = font(600, kind === 'story' ? 28 : 24); ctx.fillStyle = alpha('#ffffff', 0.92); ctx.fillText(d.ohLine, m + 16, y - (kind === 'story' ? 78 : 64)); }
    if (d.price) { ctx.font = font(800, kind === 'story' ? 104 : 88); ctx.fillStyle = fg; ctx.fillText(d.price, m + 16, y); y += kind === 'story' ? 66 : 56; }
    if (d.address) { ctx.font = font(400, kind === 'story' ? 38 : 33); ctx.fillStyle = alpha(fg === '#ffffff' ? '#ffffff' : '#1c2b30', 0.85); ctx.fillText(d.address, m + 16, y); y += kind === 'story' ? 80 : 66; }
    let cx = m + 16;
    [d.beds && `${d.beds} BD`, d.baths && `${d.baths} BA`, d.sqft && `${d.sqft} SQ FT`].filter(Boolean).forEach((t) => {
      cx += chip(ctx, cx, y, t, b.accent, fg, kind === 'story' ? 26 : 23).w + 14;
    });

    // bottom contact row
    const rowY = H - (kind === 'story' ? 150 : 130);
    ctx.strokeStyle = alpha(b.accent, 0.55); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(m + 16, rowY); ctx.lineTo(W - m - 16, rowY); ctx.stroke();
    ctx.font = font(700, kind === 'story' ? 32 : 28); ctx.fillStyle = fg;
    ctx.fillText(b.agentName || 'Your Name Here', m + 16, rowY + (kind === 'story' ? 58 : 50));
    const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
    if (sub) { ctx.globalAlpha = 0.8; ctx.font = font(400, kind === 'story' ? 24 : 21); ctx.fillText(sub, m + 16, rowY + (kind === 'story' ? 96 : 84)); ctx.globalAlpha = 1; }
    if (b.headImg && b.headImg.width) circleImg(ctx, b.headImg, W - m - 16 - 50, rowY + (kind === 'story' ? 72 : 64), kind === 'story' ? 110 : 96, b.accent);
    else logoImg(ctx, b.logoImg, W - m - 16, rowY + (kind === 'story' ? 72 : 64), kind === 'story' ? 80 : 68);
  };

  // ---- public API ------------------------------------------------------------
  const SIZES = { square: [1080, 1080], story: [1080, 1920], wide: [1200, 630] };
  const TEMPLATES = { modern, classic, bold };

  const render = (templateId, kind, canvas, d) => {
    const [W, H] = SIZES[kind];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    (TEMPLATES[templateId] || modern)(ctx, W, H, d, kind);
  };

  const download = (canvas, filename) => {
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  };

  return { render, download, SIZES, onColor, shade };
})();
