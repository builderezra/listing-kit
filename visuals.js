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
  // focus biases the vertical crop: 'top' keeps rooflines, 'bottom' keeps yards.
  const FOCUS_Y = { top: 0, center: 0.5, bottom: 1 };
  const cover = (ctx, img, x, y, w, h, r, brand, focus, filter) => {
    ctx.save();
    if (r) { rr(ctx, x, y, w, h, r); ctx.clip(); }
    else { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
    if (img && img.width) {
      const s = Math.max(w / img.width, h / img.height);
      const dw = img.width * s, dh = img.height * s;
      const fy = FOCUS_Y[focus] != null ? FOCUS_Y[focus] : 0.5;
      if (filter) { try { ctx.filter = filter; } catch (e) {} }
      ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * fy, dw, dh);
      ctx.filter = 'none';
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
    if (!text) return { w: 0, h: 0 };   // empty status (e.g. replaced by a corner stamp) → draw nothing
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

  // optional small logo watermark, top-right of a social graphic (with a soft shadow)
  const watermarkLogo = (ctx, W, H, brand) => {
    const img = brand.logoImg;
    if (!img || !img.width) return;
    const s = Math.min(W, H), pad = s * 0.05;
    const sc = Math.min((s * 0.085) / img.height, (s * 0.32) / img.width);
    const w = img.width * sc, h = img.height * sc;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = s * 0.02; ctx.shadowOffsetY = s * 0.004;
    ctx.drawImage(img, W - pad - w, pad, w, h);
    ctx.restore();
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
    if (!brand.watermark) logoImg(ctx, brand.logoImg, xRight, cy, h * 0.52);   // watermark mode draws the logo top-right instead
    return h;
  };

  const statText = (d) => {
    const p = [];
    if (d.beds) p.push(`${d.beds} BD`);
    if (d.baths) p.push(`${d.baths} BA`);
    if (d.cars) p.push(`${d.cars} CAR`);
    if (d.sqft) p.push(`${d.sqft} ${d.areaUnit === 'sqm' ? 'M²' : 'SQ FT'}`);
    return p.join('   ·   ');
  };

  // brand font preference: 'serif' | 'sans' | 'auto' (template default)
  const priceFam = (b, def) => (b.font === 'serif' ? SERIF : b.font === 'sans' ? SANS : def);

  // =====================  MODERN — full-bleed photo + gradient  ================
  const modern = (ctx, W, H, d, kind) => {
    const b = d.brand;
    cover(ctx, d.hero, 0, 0, W, H, 0, b, d.heroFocus, d.heroFilter);

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
      ctx.font = font(800, priceSize, priceFam(b, SANS));
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
      cover(ctx, d.hero, 44, 44, 596, H - 88, 0, b, d.heroFocus, d.heroFilter);
      badge(ctx, 64, 64, d.badgeText, b.accent, onColor(b.accent), 19, 4);
      ctx.textAlign = 'center';
      let y = d.ohLine ? 150 : 175;
      if (d.ohLine) { ctx.font = font(600, 22); ctx.fillStyle = mut; ctx.fillText(d.ohLine, centerX, 120); }
      if (d.price) { ctx.font = font(700, 58, priceFam(b, SERIF)); ctx.fillStyle = b.primary; ctx.fillText(d.price, centerX, y + 40); y += 95; }
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
    cover(ctx, d.hero, m, m, photoW, mainH, 0, b, d.heroFocus, d.heroFilter);
    badge(ctx, m + 22, m + 22, d.badgeText, b.accent, onColor(b.accent), kind === 'story' ? 26 : 22, 4);
    let y = m + mainH;
    if (thumbs) {
      const tw = (photoW - 14) / 2, th = kind === 'story' ? 240 : 168;
      cover(ctx, d.photos[1] && d.photos[1].img, m, y + 14, tw, th, 0, b, d.photos[1] && d.photos[1].focus, d.photos[1] && d.photos[1].fcss);
      cover(ctx, d.photos[2] && d.photos[2].img, m + tw + 14, y + 14, tw, th, 0, b, d.photos[2] && d.photos[2].focus, d.photos[2] && d.photos[2].fcss);
      y += 14 + th;
    }

    ctx.textAlign = 'center';
    const compact = kind === 'square' && thumbs;
    y += compact ? 64 : 84;
    if (d.ohLine) { ctx.font = font(600, compact ? 22 : 26); ctx.fillStyle = mut; ctx.fillText(d.ohLine, W / 2, y - (compact ? 36 : 46)); }
    if (d.price) { ctx.font = font(700, compact ? 60 : kind === 'story' ? 88 : 72, priceFam(b, SERIF)); ctx.fillStyle = b.primary; ctx.fillText(d.price, W / 2, y); y += compact ? 46 : 58; }
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
      cover(ctx, d.hero, W - 560 - m, m, 560, H - m * 2, 26, b, d.heroFocus, d.heroFilter);
      contentX = m + 12; contentW = W - 560 - m * 2 - 40;
      badge(ctx, contentX, 72, d.badgeText, b.accent, onColor(b.accent), 21);
      if (d.ohLine) { ctx.font = font(600, 20); ctx.fillStyle = alpha('#ffffff', 0.9); ctx.fillText(d.ohLine, contentX + 4, 148); }
      y = 250;
      if (d.price) { ctx.font = font(800, 64, priceFam(b, SANS)); ctx.fillStyle = fg; ctx.fillText(d.price, contentX, y); y += 52; }
      if (d.address) { ctx.font = font(400, 26); ctx.fillStyle = alpha(fg === '#ffffff' ? '#ffffff' : '#1c2b30', 0.85); ctx.fillText(d.address, contentX, y); y += 64; }
      let cx = contentX;
      [d.beds && `${d.beds} BD`, d.baths && `${d.baths} BA`, d.cars && `${d.cars} CAR`, d.sqft && `${d.sqft} ${d.areaUnit === 'sqm' ? 'M²' : 'SF'}`].filter(Boolean).forEach((t) => {
        cx += chip(ctx, cx, y, t, b.accent, fg, 20).w + 12;
      });
      ctx.font = font(700, 24); ctx.fillStyle = fg;
      ctx.fillText(b.agentName || 'Your Name Here', contentX, H - 108);
      const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
      if (sub) { ctx.globalAlpha = 0.8; ctx.font = font(400, 19); ctx.fillText(sub, contentX, H - 72); ctx.globalAlpha = 1; }
      return;
    }

    // square / story
    const photoH = kind === 'story' ? 1100 : 540;
    cover(ctx, d.hero, m, m, W - m * 2, photoH, 30, b, d.heroFocus, d.heroFilter);
    // angled badge overlapping the photo's bottom edge
    ctx.save();
    ctx.translate(m + 16, m + photoH - 26);
    ctx.transform(1, 0, -0.14, 1, 0, 0);
    badge(ctx, 0, 0, d.badgeText, b.accent, onColor(b.accent), kind === 'story' ? 30 : 26, 10);
    ctx.restore();

    y = m + photoH + (kind === 'story' ? 150 : 110);
    if (d.ohLine) { ctx.font = font(600, kind === 'story' ? 28 : 24); ctx.fillStyle = alpha('#ffffff', 0.92); ctx.fillText(d.ohLine, m + 16, y - (kind === 'story' ? 88 : 64)); }
    if (d.price) { ctx.font = font(800, kind === 'story' ? 104 : 88, priceFam(b, SANS)); ctx.fillStyle = fg; ctx.fillText(d.price, m + 16, y); y += kind === 'story' ? 66 : 56; }
    if (d.address) { ctx.font = font(400, kind === 'story' ? 38 : 33); ctx.fillStyle = alpha(fg === '#ffffff' ? '#ffffff' : '#1c2b30', 0.85); ctx.fillText(d.address, m + 16, y); y += kind === 'story' ? 84 : 66; }
    let cx = m + 16;
    [d.beds && `${d.beds} BD`, d.baths && `${d.baths} BA`, d.cars && `${d.cars} CAR`, d.sqft && `${d.sqft} ${d.areaUnit === 'sqm' ? 'M²' : 'SQ FT'}`].filter(Boolean).forEach((t) => {
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
    else if (!b.watermark) logoImg(ctx, b.logoImg, W - m - 16, rowY + (kind === 'story' ? 72 : 64), kind === 'story' ? 80 : 68);
  };

  // =====================  MINIMAL — full-bleed photo + clean white card  ======
  const minimal = (ctx, W, H, d, kind) => {
    const b = d.brand, story = kind === 'story', wide = kind === 'wide';
    cover(ctx, d.hero, 0, 0, W, H, 0, b, d.heroFocus, d.heroFilter);
    let g = ctx.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, 'rgba(0,0,0,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 220);
    const m = wide ? 34 : 44;
    badge(ctx, m, m, d.badgeText, '#ffffff', '#1c2b30', wide ? 20 : 26);
    if (d.ohLine) { ctx.font = font(600, wide ? 18 : 22); ctx.fillStyle = '#fff'; ctx.fillText(d.ohLine, m + 4, m + (wide ? 52 : 64)); }
    const pad = wide ? 30 : 40;
    const cardW = wide ? Math.min(560, Math.round(W * 0.5)) : W - m * 2;
    const cardH = story ? 384 : wide ? 250 : 300;
    const cardX = wide ? W - m - cardW : m, cardY = H - m - cardH;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#ffffff'; rr(ctx, cardX, cardY, cardW, cardH, 20); ctx.fill();
    ctx.restore();
    const ink = '#1b2a30', mut = '#717c84', lx = cardX + pad;
    ctx.textAlign = 'left';
    let y = cardY + pad + (story ? 78 : wide ? 56 : 66);
    if (d.price) { ctx.font = font(700, story ? 92 : wide ? 54 : 74, priceFam(b, SANS)); ctx.fillStyle = ink; ctx.fillText(d.price, lx, y); y += story ? 58 : wide ? 44 : 48; }
    if (d.address) { ctx.font = font(400, story ? 34 : wide ? 23 : 30); ctx.fillStyle = mut; ctx.fillText(d.address, lx, y); y += story ? 50 : 42; }
    ctx.fillStyle = b.accent; ctx.fillRect(lx, y - 16, 54, 4); y += 26;
    const stats = statText(d);
    if (stats) { ctx.font = font(600, story ? 26 : wide ? 20 : 22); ctx.fillStyle = ink; spacing(ctx, 2); ctx.fillText(stats, lx, y); spacing(ctx, 0); }
    const ay = cardY + cardH - pad;
    ctx.font = font(700, story ? 26 : wide ? 20 : 22); ctx.fillStyle = ink;
    ctx.fillText(b.agentName || '', lx, ay);
    const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
    if (sub) { ctx.font = font(400, story ? 20 : 17); ctx.fillStyle = mut; ctx.fillText(sub, lx, ay + (story ? 30 : 26)); }
    // headshot + logo, bottom-right of the card
    let hx = cardX + cardW - pad;
    if (b.headImg && b.headImg.width) { const hd = story ? 64 : 54; circleImg(ctx, b.headImg, hx - hd / 2, ay - (story ? 6 : 4), hd, b.accent); hx -= hd + (story ? 16 : 12); }
    if (b.logoImg && b.logoImg.width && !b.watermark) logoImg(ctx, b.logoImg, hx, ay - 6, story ? 56 : 46);
    ctx.textAlign = 'left';
  };

  // =====================  LUXE — dark editorial, serif, gold hairlines  ========
  const luxe = (ctx, W, H, d, kind) => {
    const b = d.brand, story = kind === 'story', wide = kind === 'wide';
    const ink = '#f3ece0', mut = 'rgba(243,236,224,0.62)';
    ctx.fillStyle = '#14110e'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = alpha(b.accent, 0.55); ctx.lineWidth = 1.5;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    const kicker = (d.badgeText || (d.stamp ? '' : 'FOR SALE')).toUpperCase();
    if (wide) {
      cover(ctx, d.hero, 44, 44, Math.round(W * 0.5) - 44, H - 88, 0, b, d.heroFocus, d.heroFilter);
      const cx = Math.round(W * 0.5) + (W - Math.round(W * 0.5) - 44) / 2;
      ctx.textAlign = 'center';
      let y = 200;
      ctx.font = font(600, 18); spacing(ctx, 6); ctx.fillStyle = b.accent; ctx.fillText(kicker, cx, y); spacing(ctx, 0); y += 78;
      if (d.price) { ctx.font = font(500, 62, SERIF); ctx.fillStyle = ink; ctx.fillText(d.price, cx, y); y += 56; }
      ctx.strokeStyle = alpha(b.accent, 0.85); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx - 42, y - 8); ctx.lineTo(cx + 42, y - 8); ctx.stroke(); y += 44;
      if (d.address) { ctx.font = font(400, 26); ctx.fillStyle = mut; ctx.fillText(d.address, cx, y); y += 52; }
      const stats = statText(d); if (stats) { ctx.font = font(500, 20); spacing(ctx, 3); ctx.fillStyle = ink; ctx.fillText(stats, cx, y); spacing(ctx, 0); }
      const lname = b.agentName || 'Your Name Here';
      ctx.font = font(500, 24, SERIF); ctx.fillStyle = ink; ctx.fillText(lname, cx, H - 104);
      if (b.headImg && b.headImg.width) { const hd = 66, nw = ctx.measureText(lname).width; circleImg(ctx, b.headImg, cx - nw / 2 - hd / 2 - 18, H - 104 - 9, hd, b.accent); }
      const sub = [b.brokerage, b.phone].filter(Boolean).join('   ·   '); if (sub) { ctx.font = font(400, 18); ctx.fillStyle = mut; ctx.fillText(sub, cx, H - 74); }
      ctx.textAlign = 'left'; return;
    }
    const mm = 56, photoTop = mm + (story ? 36 : 26);
    const photoH = story ? 1060 : 624;
    cover(ctx, d.hero, mm, photoTop, W - mm * 2, photoH, 0, b, d.heroFocus, d.heroFilter);
    ctx.textAlign = 'center';
    let y = photoTop + photoH + (story ? 134 : 108);
    ctx.font = font(600, story ? 22 : 19); spacing(ctx, 6); ctx.fillStyle = b.accent;
    ctx.fillText(kicker, W / 2, y - (story ? 92 : 76)); spacing(ctx, 0);
    if (d.price) { ctx.font = font(500, story ? 92 : 76, SERIF); ctx.fillStyle = ink; ctx.fillText(d.price, W / 2, y); y += story ? 60 : 52; }
    ctx.strokeStyle = alpha(b.accent, 0.85); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(W / 2 - 44, y - 10); ctx.lineTo(W / 2 + 44, y - 10); ctx.stroke(); y += 40;
    if (d.address) { ctx.font = font(400, story ? 34 : 30); ctx.fillStyle = mut; ctx.fillText(d.address, W / 2, y); y += story ? 52 : 46; }
    const stats = statText(d); if (stats) { ctx.font = font(500, story ? 26 : 23); spacing(ctx, 3); ctx.fillStyle = ink; ctx.fillText(stats, W / 2, y); spacing(ctx, 0); }
    const baseY = H - (story ? 104 : 84);
    const lname = b.agentName || 'Your Name Here';
    ctx.font = font(500, story ? 30 : 26, SERIF); ctx.fillStyle = ink; ctx.fillText(lname, W / 2, baseY);
    if (b.headImg && b.headImg.width) { const hd = story ? 78 : 62, nw = ctx.measureText(lname).width; circleImg(ctx, b.headImg, W / 2 - nw / 2 - hd / 2 - (story ? 26 : 18), baseY - (story ? 12 : 9), hd, b.accent); }
    const sub = [b.brokerage, b.phone].filter(Boolean).join('   ·   '); if (sub) { ctx.font = font(400, story ? 22 : 19); ctx.fillStyle = mut; ctx.fillText(sub, W / 2, baseY + (story ? 34 : 30)); }
    ctx.textAlign = 'left';
  };

  // =====================  BANNER — photo + solid brand colour band  ===========
  const banner = (ctx, W, H, d, kind) => {
    const b = d.brand, story = kind === 'story', wide = kind === 'wide';
    const fg = onColor(b.primary);
    if (wide) {
      const panelW = Math.round(W * 0.4);
      cover(ctx, d.hero, 0, 0, W - panelW, H, 0, b, d.heroFocus, d.heroFilter);
      ctx.fillStyle = b.primary; ctx.fillRect(W - panelW, 0, panelW, H);
      ctx.fillStyle = b.accent; ctx.fillRect(W - panelW, 0, 6, H);
      badge(ctx, 36, 36, d.badgeText, b.accent, onColor(b.accent), 22);
      const px = W - panelW + 44; let y = 220;
      if (d.price) { ctx.font = font(800, 58, priceFam(b, SANS)); ctx.fillStyle = fg; ctx.fillText(d.price, px, y); y += 54; }
      if (d.address) { ctx.font = font(400, 25); ctx.fillStyle = alpha(fg, 0.9); ctx.fillText(d.address, px, y); y += 40; }
      ctx.fillStyle = b.accent; ctx.fillRect(px, y - 8, 52, 4); y += 36;
      const stats = statText(d); if (stats) { ctx.font = font(600, 20); spacing(ctx, 3); ctx.fillStyle = fg; ctx.fillText(stats, px, y); spacing(ctx, 0); }
      ctx.font = font(700, 24); ctx.fillStyle = fg; ctx.fillText(b.agentName || 'Your Name Here', px, H - 108);
      const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  '); if (sub) { ctx.globalAlpha = 0.82; ctx.font = font(400, 18); ctx.fillText(sub, px, H - 76); ctx.globalAlpha = 1; }
      if (b.headImg && b.headImg.width) circleImg(ctx, b.headImg, W - 56 - 42, H - 100, 84, b.accent);
      return;
    }
    const bandH = story ? 624 : 364;
    cover(ctx, d.hero, 0, 0, W, H - bandH, 0, b, d.heroFocus, d.heroFilter);
    ctx.fillStyle = b.primary; ctx.fillRect(0, H - bandH, W, bandH);
    ctx.fillStyle = b.accent; ctx.fillRect(0, H - bandH, W, 6);
    const m = 56;
    badge(ctx, m - 8, 40, d.badgeText, b.accent, onColor(b.accent), story ? 30 : 26);
    let y = H - bandH + (story ? 118 : 92);
    if (d.price) { ctx.font = font(800, story ? 104 : 80, priceFam(b, SANS)); ctx.fillStyle = fg; ctx.fillText(d.price, m, y); y += story ? 60 : 50; }
    if (d.address) { ctx.font = font(400, story ? 36 : 30); ctx.fillStyle = alpha(fg, 0.92); ctx.fillText(d.address, m, y); y += story ? 50 : 42; }
    ctx.fillStyle = b.accent; ctx.fillRect(m, y - 14, 56, 4); y += 26;
    const stats = statText(d); if (stats) { ctx.font = font(600, story ? 27 : 23); spacing(ctx, 3); ctx.fillStyle = fg; ctx.fillText(stats, m, y); spacing(ctx, 0); }
    const ry = H - (story ? 70 : 54);
    ctx.font = font(700, story ? 30 : 26); ctx.fillStyle = fg; ctx.fillText(b.agentName || 'Your Name Here', m, ry);
    const sub = [b.brokerage, b.phone].filter(Boolean).join('  ·  ');
    if (sub) { ctx.globalAlpha = 0.82; ctx.font = font(400, story ? 22 : 19); ctx.fillText(sub, m, ry + (story ? 32 : 27)); ctx.globalAlpha = 1; }
    let xr = W - m;
    if (b.headImg && b.headImg.width) { const hd = story ? 96 : 78; circleImg(ctx, b.headImg, xr - hd / 2, ry - (story ? 18 : 14), hd, b.accent); xr -= hd + (story ? 20 : 16); }
    if (b.logoImg && b.logoImg.width && !b.watermark) logoImg(ctx, b.logoImg, xr, ry, story ? 64 : 52);
  };

  // =====================  CAROUSEL SLIDES (1080×1080)  =========================
  // wrap text to maxWidth, at most `maxLines` lines (ellipsis on overflow)
  const wrapText = (ctx, text, maxWidth, maxLines) => {
    const words = String(text).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const tryLine = line ? line + ' ' + w : w;
      if (ctx.measureText(tryLine).width <= maxWidth || !line) line = tryLine;
      else {
        lines.push(line);
        line = w;
        if (lines.length === maxLines) break;
      }
    }
    if (lines.length < maxLines && line) lines.push(line);
    else if (line && lines.length === maxLines) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…';
    return lines;
  };

  // photo slide with a feature caption + position dots
  const featureSlide = (canvas, { photo, caption, brand, idx, total }) => {
    const W = 1080, H = 1080;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    cover(ctx, photo && photo.img, 0, 0, W, H, 0, brand, photo && photo.focus, photo && photo.fcss);

    const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
    g.addColorStop(0, 'rgba(8,14,18,0)');
    g.addColorStop(1, 'rgba(8,14,18,0.85)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.45);

    // position dots, top-right
    for (let i = 0; i < total; i++) {
      ctx.beginPath();
      ctx.arc(W - 52 - (total - 1 - i) * 26, 52, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = i === idx ? '#ffffff' : 'rgba(255,255,255,0.45)';
      ctx.fill();
    }

    let y = H - 96;
    if (caption) {
      ctx.font = font(700, 46, priceFam(brand, SANS));
      const lines = wrapText(ctx, caption, W - 128, 2);
      y = H - 96 - (lines.length - 1) * 58;
      ctx.fillStyle = '#ffffff';
      lines.forEach((l, i) => ctx.fillText(l, 64, y + i * 58));
      // accent tick above the caption
      ctx.fillStyle = brand.accent;
      ctx.fillRect(64, y - 58, 56, 5);
      y -= 0;
    }
    // counter + name, bottom corners
    ctx.font = font(600, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(brand.agentName || '', 64, H - 36);
    ctx.textAlign = 'right';
    ctx.fillText(`${idx + 1}/${total}`, W - 52, H - 36);
    ctx.textAlign = 'left';
  };

  // closing call-to-action slide
  const ctaSlide = (canvas, { brand, address, badgeText, ohLine }) => {
    const W = 1080, H = 1080;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const fg = onColor(brand.primary);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(brand.primary, 16));
    g.addColorStop(1, shade(brand.primary, -32));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // decorative ring
    ctx.beginPath(); ctx.arc(W - 120, 140, 190, 0, Math.PI * 2);
    ctx.strokeStyle = alpha(brand.accent, 0.35); ctx.lineWidth = 3; ctx.stroke();

    let y = 330;
    if (brand.headImg && brand.headImg.width) circleImg(ctx, brand.headImg, W / 2, y - 60, 230, brand.accent);
    else if (brand.logoImg && brand.logoImg.width) {
      // centre the logo (logoImg is right-anchored, so pass the right edge as W/2 + halfWidth)
      const img = brand.logoImg, s = Math.min(150 / img.height, 280 / img.width), lw = img.width * s;
      logoImg(ctx, img, W / 2 + lw / 2, y - 60, 150);
    }

    ctx.textAlign = 'center';
    ctx.font = font(700, 66, priceFam(brand, SANS));
    ctx.fillStyle = fg;
    ctx.fillText(ohLine ? 'See you at the home open' : 'Like what you see?', W / 2, y + 130);

    // pill CTA
    const ctaText = ohLine ? 'ALL WELCOME' : 'BOOK YOUR PRIVATE VIEWING';
    ctx.font = font(800, 30);
    spacing(ctx, 4);
    const tw = ctx.measureText(ctaText).width;
    const pw = tw + 76, ph = 78, px = (W - pw) / 2, py = y + 190;
    ctx.fillStyle = brand.accent;
    rr(ctx, px, py, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = onColor(brand.accent);
    ctx.textBaseline = 'middle';
    ctx.fillText(ctaText, W / 2, py + ph / 2 + 2);
    ctx.textBaseline = 'alphabetic';
    spacing(ctx, 0);
    // the open-home date/time, when scheduled
    if (ohLine) { ctx.font = font(700, 34); ctx.fillStyle = alpha(brand.accent, 0.95); ctx.fillText(ohLine, W / 2, py + ph + 56); }

    y = py + ph + 110;
    ctx.font = font(700, 40); ctx.fillStyle = fg;
    ctx.fillText(brand.agentName || 'Your Name Here', W / 2, y);
    ctx.font = font(400, 28); ctx.globalAlpha = 0.85;
    if (brand.brokerage) { y += 48; ctx.fillText(brand.brokerage, W / 2, y); }
    const contact = [brand.phone, brand.email].filter(Boolean).join('   ·   ');
    if (contact) { y += 44; ctx.fillText(contact, W / 2, y); }
    ctx.globalAlpha = 1;
    if (address) {
      ctx.font = font(600, 24); ctx.fillStyle = alpha(brand.accent, 0.95);
      spacing(ctx, 2);
      ctx.fillText(address.toUpperCase(), W / 2, H - 72);
      spacing(ctx, 0);
    }
    ctx.textAlign = 'left';
  };

  // ---- open-home kit: event post, directional arrow sign, weekly roundup ----
  // shrink a font until the text fits maxW (sets ctx.font, returns the size used)
  const fitFont = (ctx, text, maxW, size, weight, fam) => {
    let s = size; ctx.font = font(weight, s, fam || SANS);
    while (s > 12 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = font(weight, s, fam || SANS); }
    return s;
  };
  // block arrow centred at (cx,cy), pointing along angle (0=right, π=left, −π/2=up)
  const blockArrow = (ctx, cx, cy, len, thick, angle, color) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    const half = len / 2, sw = thick, headLen = len * 0.44, hw = thick * 2.0;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-half, -sw / 2); ctx.lineTo(half - headLen, -sw / 2); ctx.lineTo(half - headLen, -hw / 2);
    ctx.lineTo(half, 0);
    ctx.lineTo(half - headLen, hw / 2); ctx.lineTo(half - headLen, sw / 2); ctx.lineTo(-half, sw / 2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  // a social post built around the open-home date & time, over the hero photo
  const openHomePost = (canvas, kind, { brand, d, when, photo }) => {
    const story = kind === 'story';
    const [W, H] = story ? [1080, 1920] : [1080, 1080];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    // feature the chosen photo (a property shot or the agent), else the hero
    const img = (photo && photo.img) ? photo.img : d.hero;
    const focus = photo ? (photo.focus || 'center') : d.heroFocus;
    const filt = photo ? (photo.fcss || '') : d.heroFilter;
    cover(ctx, img, 0, 0, W, H, 0, brand, focus, filt);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(8,14,18,0.66)'); g.addColorStop(0.42, 'rgba(8,14,18,0.24)');
    g.addColorStop(0.72, 'rgba(8,14,18,0.5)'); g.addColorStop(1, 'rgba(8,14,18,0.92)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const isRent = d.raw && d.raw.mode === 'rent';
    const cx = W / 2;
    ctx.textAlign = 'center';
    let y = story ? H * 0.30 : H * 0.27;

    ctx.fillStyle = brand.accent; spacing(ctx, 8);
    ctx.font = font(800, story ? 44 : 40, priceFam(brand, SANS));
    ctx.fillText(isRent ? 'OPEN FOR INSPECTION' : 'HOME OPEN', cx, y); spacing(ctx, 0);
    ctx.fillStyle = brand.accent; ctx.fillRect(cx - 46, y + 26, 92, 6);

    if (when.date) {
      y += story ? 150 : 124;
      const dl = when.date.toUpperCase();
      fitFont(ctx, dl, W - 140, story ? 100 : 86, 800, priceFam(brand, SANS));
      ctx.fillStyle = '#ffffff'; ctx.fillText(dl, cx, y);
    }
    if (when.time) {
      y += story ? 116 : 98;
      fitFont(ctx, when.time, W - 200, story ? 76 : 66, 700, priceFam(brand, SANS));
      ctx.fillStyle = brand.accent; ctx.fillText(when.time, cx, y);
    }
    if (d.address) {
      const ay = story ? H * 0.72 : H * 0.70;
      fitFont(ctx, d.address, W - 160, story ? 44 : 40, 600, SANS);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(d.address, cx, ay);
    }
    const yb = H - (story ? 150 : 92);
    if (brand.agentName) { ctx.font = font(700, story ? 40 : 34); ctx.fillStyle = '#fff'; ctx.fillText(brand.agentName, cx, yb); }
    const sub = [brand.brokerage, brand.phone].filter(Boolean).join('   ·   ');
    if (sub) { ctx.font = font(400, story ? 30 : 26); ctx.globalAlpha = 0.85; ctx.fillStyle = '#fff'; ctx.fillText(sub, cx, yb + (story ? 44 : 38)); ctx.globalAlpha = 1; }
    ctx.textAlign = 'left';
  };

  // printable directional sign with a big arrow pointing the way to the open
  const arrowSign = (canvas, { brand, d, when, dir }) => {
    const W = 1400, H = 1000;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const prim = brand.primary, acc = brand.accent, fg = onColor(prim);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(prim, 14)); g.addColorStop(1, shade(prim, -28));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = alpha(acc, 0.92); ctx.lineWidth = 16; ctx.strokeRect(30, 30, W - 60, H - 60);

    const direction = (dir === 'left' || dir === 'up') ? dir : 'right';
    let box;
    if (direction === 'up') { blockArrow(ctx, W / 2, H * 0.30, 320, 130, -Math.PI / 2, acc); box = { cx: W / 2, w: W - 200, cy: H * 0.70 }; }
    else if (direction === 'left') { blockArrow(ctx, W * 0.24, H / 2, 380, 138, Math.PI, acc); box = { cx: W * 0.66, w: W * 0.5, cy: H / 2 }; }
    else { blockArrow(ctx, W * 0.76, H / 2, 380, 138, 0, acc); box = { cx: W * 0.34, w: W * 0.5, cy: H / 2 }; }

    ctx.textAlign = 'center';
    const isRent = d.raw && d.raw.mode === 'rent';
    let y = box.cy - (direction === 'up' ? 30 : 130);
    spacing(ctx, 5); ctx.fillStyle = acc;
    const hdr = isRent ? 'INSPECTION' : 'HOME OPEN';
    fitFont(ctx, hdr, box.w, 92, 800, priceFam(brand, SANS));
    ctx.fillText(hdr, box.cx, y); spacing(ctx, 0);
    const dtl = [when.date, when.time].filter(Boolean).join('   ');
    if (dtl) { y += 104; fitFont(ctx, dtl, box.w, 66, 700, priceFam(brand, SANS)); ctx.fillStyle = fg; ctx.fillText(dtl, box.cx, y); }
    if (d.address) { y += 82; fitFont(ctx, d.address, box.w, 50, 600, SANS); ctx.fillStyle = fg; ctx.globalAlpha = 0.9; ctx.fillText(d.address, box.cx, y); ctx.globalAlpha = 1; }
    if (brand.brokerage) { spacing(ctx, 3); ctx.fillStyle = acc; ctx.font = font(700, 30); ctx.fillText(brand.brokerage.toUpperCase(), W / 2, H - 74); spacing(ctx, 0); }
    ctx.textAlign = 'left';
  };

  // one graphic listing several upcoming home opens (address + day/time)
  const opensRoundup = (canvas, { brand, items }) => {
    const W = 1080, H = 1080;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const prim = brand.primary, acc = brand.accent, fg = onColor(prim);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(prim, 14)); g.addColorStop(1, shade(prim, -30));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.fillStyle = acc; spacing(ctx, 6);
    ctx.font = font(800, 54, priceFam(brand, SANS));
    ctx.fillText('HOME OPENS THIS WEEK', W / 2, 130); spacing(ctx, 0);
    ctx.fillStyle = acc; ctx.fillRect(W / 2 - 60, 156, 120, 6);

    const list = (items || []).slice(0, 6);
    const top = 228, bottom = brand.brokerage ? H - 120 : H - 70;
    const rowH = (bottom - top) / Math.max(1, list.length);
    ctx.textAlign = 'left';
    list.forEach((it, i) => {
      const ry = top + i * rowH, midY = ry + rowH / 2;
      if (i) { ctx.strokeStyle = alpha(fg, 0.18); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(80, ry); ctx.lineTo(W - 80, ry); ctx.stroke(); }
      ctx.textBaseline = 'middle'; ctx.fillStyle = fg;
      fitFont(ctx, it.address || 'Listing', W - 172, 40, 700, SANS);
      ctx.fillText(it.address || 'Listing', 86, midY - 22);
      ctx.fillStyle = acc; ctx.font = font(600, 32);
      ctx.fillText([it.when && it.when.date, it.when && it.when.time].filter(Boolean).join('  ·  '), 86, midY + 24);
      ctx.textBaseline = 'alphabetic';
    });
    if (brand.brokerage) { ctx.textAlign = 'center'; ctx.fillStyle = acc; ctx.font = font(700, 30); spacing(ctx, 3); ctx.fillText(brand.brokerage.toUpperCase(), W / 2, H - 60); spacing(ctx, 0); }
    ctx.textAlign = 'left';
  };

  // client testimonial / review post (square or story), in the agent's brand colours
  const testimonial = (canvas, kind, { brand, quote, author, role, rating }) => {
    const story = kind === 'story';
    const [W, H] = story ? [1080, 1920] : [1080, 1080];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const prim = brand.primary, acc = brand.accent, fg = onColor(prim);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(prim, 14)); g.addColorStop(1, shade(prim, -34));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = alpha(acc, 0.5); ctx.lineWidth = 2; ctx.strokeRect(42, 42, W - 84, H - 84);
    ctx.textAlign = 'center';

    ctx.fillStyle = alpha(acc, 0.92); ctx.font = font(800, story ? 230 : 196, SERIF);
    ctx.fillText('“', W / 2, story ? 380 : 312);

    const r = Math.max(0.5, Math.min(5, rating || 5));   // supports half-stars (e.g. 4.5)
    const starSize = story ? 60 : 54, starsY = story ? 470 : 392;
    ctx.font = font(400, starSize); ctx.textAlign = 'center';
    const sw = ctx.measureText('★').width, gap = starSize * 0.16, totalW = 5 * sw + 4 * gap;
    let sx = W / 2 - totalW / 2 + sw / 2;
    for (let i = 0; i < 5; i++) {
      const level = r - i;                                          // >=1 full · 0.5 half · <=0 empty
      ctx.fillStyle = alpha(fg, 0.25); ctx.fillText('★', sx, starsY);   // faint base star
      if (level >= 1) { ctx.fillStyle = acc; ctx.fillText('★', sx, starsY); }
      else if (level >= 0.5) { ctx.save(); ctx.beginPath(); ctx.rect(sx - sw / 2 - 1, starsY - starSize, sw / 2 + 1, starSize * 2); ctx.clip(); ctx.fillStyle = acc; ctx.fillText('★', sx, starsY); ctx.restore(); }
      sx += sw + gap;
    }

    const q = String(quote || 'Add a client review to create a testimonial post.').trim();
    ctx.fillStyle = fg; ctx.font = font(500, story ? 56 : 50, SERIF);
    const lines = wrapText(ctx, q, W - 200, story ? 7 : 5);
    const lh = story ? 76 : 66;
    const qy = story ? 600 : 480;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, qy + i * lh));
    let y = qy + (lines.length - 1) * lh;

    if (author) { y += story ? 112 : 94; ctx.font = font(700, story ? 42 : 38, priceFam(brand, SANS)); ctx.fillStyle = acc; ctx.fillText('— ' + author, W / 2, y); }
    if (role) { y += story ? 48 : 42; ctx.font = font(400, story ? 28 : 26); ctx.fillStyle = alpha(fg, 0.82); ctx.fillText(role, W / 2, y); }

    const foot = [brand.agentName, brand.brokerage].filter(Boolean).join('   ·   ');
    if (foot) { ctx.font = font(600, story ? 30 : 27); ctx.fillStyle = alpha(fg, 0.9); ctx.fillText(foot, W / 2, H - (story ? 96 : 72)); }
    ctx.textAlign = 'left';
  };

  // "Thinking of selling?" prospecting / lead-gen post (brand colours)
  const prospectPost = (canvas, kind, { brand, headline, sub, suburb }) => {
    const story = kind === 'story';
    const [W, H] = story ? [1080, 1920] : [1080, 1080];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const prim = brand.primary, acc = brand.accent, fg = onColor(prim);
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, shade(prim, 18)); g.addColorStop(1, shade(prim, -34));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.beginPath(); ctx.arc(W - 90, 120, 200, 0, Math.PI * 2); ctx.strokeStyle = alpha(acc, 0.3); ctx.lineWidth = 3; ctx.stroke();
    ctx.textAlign = 'center';
    let y = story ? 560 : 430;
    ctx.fillStyle = acc; spacing(ctx, 6); ctx.font = font(700, story ? 34 : 30, priceFam(brand, SANS));
    ctx.fillText((suburb ? suburb.toUpperCase() : 'YOUR AREA') + ' PROPERTY', W / 2, y - (story ? 92 : 78)); spacing(ctx, 0);
    const hl = (headline || 'Thinking of selling?').trim();
    ctx.fillStyle = fg; ctx.font = font(700, story ? 96 : 84, priceFam(brand, SANS));
    fitFont(ctx, hl, W - 150, story ? 96 : 84, 700, priceFam(brand, SANS));
    ctx.fillText(hl, W / 2, y);
    const st = (sub || 'Find out what your home could be worth in today’s market — no obligation.').trim();
    ctx.font = font(400, story ? 40 : 36); ctx.fillStyle = alpha(fg, 0.92);
    const lines = wrapText(ctx, st, W - 220, 3); y += story ? 90 : 78;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * (story ? 54 : 48)));
    y += (lines.length - 1) * (story ? 54 : 48);
    // CTA pill
    const cta = 'BOOK A FREE APPRAISAL';
    ctx.font = font(800, story ? 32 : 28); spacing(ctx, 3);
    const tw = ctx.measureText(cta).width, pw = tw + 76, ph = story ? 84 : 76, px = (W - pw) / 2, py = y + (story ? 90 : 76);
    ctx.fillStyle = acc; rr(ctx, px, py, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = onColor(acc); ctx.textBaseline = 'middle'; ctx.fillText(cta, W / 2, py + ph / 2 + 2); ctx.textBaseline = 'alphabetic'; spacing(ctx, 0);
    // agent footer
    const foot = [brand.agentName, brand.phone].filter(Boolean).join('   ·   ');
    if (foot) { ctx.font = font(600, story ? 30 : 27); ctx.fillStyle = alpha(fg, 0.9); ctx.fillText(foot, W / 2, H - (story ? 96 : 70)); }
    ctx.textAlign = 'left';
  };

  // "Meet the agent" intro post (headshot + name + tagline + bio + contact)
  const agentPost = (canvas, kind, { brand, tagline, bio }) => {
    const story = kind === 'story';
    const [W, H] = story ? [1080, 1920] : [1080, 1080];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const prim = brand.primary, acc = brand.accent, fg = onColor(prim);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(prim, 16)); g.addColorStop(1, shade(prim, -34));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    let y = story ? 430 : 340;
    if (brand.headImg && brand.headImg.width) circleImg(ctx, brand.headImg, W / 2, y, story ? 320 : 280, acc);
    else { ctx.beginPath(); ctx.arc(W / 2, y, (story ? 320 : 280) / 2, 0, Math.PI * 2); ctx.fillStyle = alpha(fg, 0.12); ctx.fill(); ctx.strokeStyle = acc; ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = alpha(fg, 0.5); ctx.font = font(400, story ? 120 : 104); ctx.fillText('🙂', W / 2, y + (story ? 44 : 38)); }
    y += (story ? 320 : 280) / 2 + (story ? 110 : 96);
    ctx.fillStyle = acc; spacing(ctx, 5); ctx.font = font(700, story ? 30 : 27, priceFam(brand, SANS));
    ctx.fillText('MEET YOUR AGENT', W / 2, y - (story ? 64 : 56)); spacing(ctx, 0);
    ctx.fillStyle = fg; ctx.font = font(700, story ? 72 : 62, priceFam(brand, SANS));
    fitFont(ctx, brand.agentName || 'Your Name Here', W - 160, story ? 72 : 62, 700, priceFam(brand, SANS));
    ctx.fillText(brand.agentName || 'Your Name Here', W / 2, y);
    const tg = (tagline || ((brand.brokerage ? brand.brokerage + ' · ' : '') + 'Your local property specialist')).trim();
    ctx.font = font(400, story ? 36 : 32); ctx.fillStyle = alpha(fg, 0.85); y += story ? 56 : 50; ctx.fillText(tg, W / 2, y);
    if (bio && bio.trim()) {
      ctx.font = font(400, story ? 34 : 30); ctx.fillStyle = alpha(fg, 0.9);
      const lines = wrapText(ctx, bio.trim(), W - 220, story ? 5 : 3); y += story ? 80 : 70;
      lines.forEach((l, i) => ctx.fillText(l, W / 2, y + i * (story ? 50 : 44)));
    }
    const contact = [brand.phone, brand.email].filter(Boolean).join('   ·   ');
    if (contact) { ctx.font = font(600, story ? 30 : 27); ctx.fillStyle = acc; ctx.fillText(contact, W / 2, H - (story ? 96 : 70)); }
    ctx.textAlign = 'left';
  };

  // diagonal corner banner ("SOLD" / "UNDER OFFER" …) stamped over any graphic.
  // Drawn as a post-render overlay so it works on every template uniformly.
  const STAMP_COLORS = {
    'SOLD': '#c0392b', 'LEASED': '#c0392b', 'UNDER OFFER': '#b9770e',
    'PRICE REDUCED': '#1e8449', 'COMING SOON': '#21618c', 'NEW LISTING': '#21618c',
  };
  const cornerSash = (ctx, W, H, text, color) => {
    const label = String(text || '').toUpperCase().trim();
    if (!label) return;
    const fill = color || STAMP_COLORS[label] || '#c0392b';
    const s = Math.min(W, H);
    const a1 = s * 0.235, a2 = s * 0.383;      // band edges as (x − y) offsets from the top-right corner
    const am = (a1 + a2) / 2;
    const pts = [[W - a1, 0], [W - a2, 0], [W, a2], [W, a1]];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    pts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.30)'; ctx.shadowBlur = s * 0.022; ctx.shadowOffsetX = -s * 0.004; ctx.shadowOffsetY = s * 0.006;
    ctx.fillStyle = fill; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = Math.max(1, s * 0.004); ctx.stroke();
    // text along the diagonal, centred on the band, shrunk to fit
    const cx = (4 * W - a1 - a2) / 4, cy = (a1 + a2) / 4;
    const chord = am * Math.SQRT2;
    let fs = s * 0.066;
    spacing(ctx, Math.max(1, s * 0.004));
    ctx.font = font(800, fs);
    const tw = ctx.measureText(label).width, maxW = chord * 0.84;
    if (tw > maxW) { fs *= maxW / tw; ctx.font = font(800, fs); }
    ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff'; ctx.fillText(label, 0, 0);
    spacing(ctx, 0);
    ctx.restore();
  };

  // ---- public API ------------------------------------------------------------
  const SIZES = { square: [1080, 1080], story: [1080, 1920], wide: [1200, 630] };
  const TEMPLATES = { modern, classic, bold, minimal, luxe, banner };

  const render = (templateId, kind, canvas, d) => {
    const [W, H] = SIZES[kind];
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // a status stamp REPLACES the small status badge — blank it so the two don't clash
    const td = (d && d.stamp) ? Object.assign({}, d, { badgeText: '' }) : d;
    (TEMPLATES[templateId] || modern)(ctx, W, H, td, kind);
    if (d && d.stamp) cornerSash(ctx, W, H, d.stamp);
    else if (d && d.brand && d.brand.watermark && d.brand.logoImg) watermarkLogo(ctx, W, H, d.brand);
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

  // =====================  SIGN BOARD (1200×900) with QR code  ==================
  const signboard = (canvas, { brand, d, status, qrUrl }) => {
    const W = 1200, H = 900;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const b = brand;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    // top status bar
    const barH = 132, fg = onColor(b.primary);
    ctx.fillStyle = b.primary; ctx.fillRect(0, 0, W, barH);
    ctx.fillStyle = fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = font(800, 56); spacing(ctx, 3);
    ctx.fillText(status || (d.stamp ? '' : 'FOR SALE'), 48, barH / 2 + 3); spacing(ctx, 0);
    if (b.brokerage && !d.stamp) { ctx.textAlign = 'right'; ctx.font = font(600, 30); ctx.globalAlpha = 0.92; ctx.fillText(b.brokerage, W - 48, barH / 2 + 2); ctx.globalAlpha = 1; ctx.textAlign = 'left'; }
    ctx.textBaseline = 'alphabetic';

    // hero photo band + accent rule
    const photoY = barH, photoH = 356;
    cover(ctx, d.hero, 0, photoY, W, photoH, 0, b, d.heroFocus, d.heroFilter);
    ctx.fillStyle = b.accent; ctx.fillRect(0, photoY + photoH, W, 8);

    // price / address / stats (left, in the white zone — QR sits to their right)
    let y = photoY + photoH + 82;
    // open-home date/time pill (when scheduled) — sits below the accent rule
    if (d.ohLine) {
      ctx.font = font(800, 27); spacing(ctx, 1.5);
      const tw = ctx.measureText(d.ohLine).width, pw = tw + 44, ph = 50, px = 48, oy = photoY + photoH + 18;
      ctx.fillStyle = b.accent; rr(ctx, px, oy, pw, ph, ph / 2); ctx.fill();
      ctx.fillStyle = onColor(b.accent); ctx.textBaseline = 'middle'; ctx.fillText(d.ohLine, px + 22, oy + ph / 2 + 1);
      ctx.textBaseline = 'alphabetic'; spacing(ctx, 0);
      y += 60;
    }
    if (d.price) { ctx.font = font(800, 78, priceFam(b, SANS)); ctx.fillStyle = b.primary; ctx.fillText(d.price, 48, y); }
    if (d.address) { y += 58; ctx.font = font(400, 36); ctx.fillStyle = '#23333b'; ctx.fillText(d.address, 48, y); }
    const stats = statText(d);
    if (stats) { y += 50; ctx.font = font(600, 30); spacing(ctx, 3); ctx.fillStyle = '#23333b'; ctx.fillText(stats, 48, y); spacing(ctx, 0); }

    // agent contact row pinned to the very bottom (left); logo/headshot to its left
    const ay = H - 70;
    let ax = 48;
    if (b.headImg && b.headImg.width) { const dd = 96; circleImg(ctx, b.headImg, 48 + dd / 2, ay, dd, b.accent); ax = 48 + dd + 20; }
    else if (b.logoImg && b.logoImg.width) { const lw = logoImg(ctx, b.logoImg, 48 + 150, ay, 78); ax = 48 + 150 + 18; }
    ctx.fillStyle = '#1c2b30'; ctx.font = font(700, 36); ctx.textBaseline = 'middle'; ctx.fillText(b.agentName || 'Your Name Here', ax, ay - 16);
    const contact = [b.phone, b.email].filter(Boolean).join('   ·   ');
    if (contact) { ctx.font = font(400, 28); ctx.fillStyle = '#5d6e75'; ctx.fillText(contact, ax, ay + 20); }
    ctx.textBaseline = 'alphabetic';

    // QR (right side, vertically centred in the white zone)
    if (qrUrl && typeof QR !== 'undefined') {
      const qs = 196, qx = W - qs - 56, qy = photoY + photoH + 44;
      ctx.fillStyle = '#ffffff'; rr(ctx, qx - 14, qy - 14, qs + 28, qs + 28, 14); ctx.fill();
      ctx.strokeStyle = alpha(b.primary, 0.18); ctx.lineWidth = 2; ctx.stroke();
      try { QR.draw(ctx, qrUrl, qx, qy, qs, '#1c2b30'); } catch (e) {}
      ctx.fillStyle = '#5d6e75'; ctx.font = font(700, 24); ctx.textAlign = 'center';
      ctx.fillText('Scan for details', qx + qs / 2, qy + qs + 34); ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#9aa6ac'; ctx.font = font(500, 26); ctx.textAlign = 'right';
      ctx.fillText('Add a link below for a QR code →', W - 52, H - 110); ctx.textAlign = 'left';
    }
    if (d && d.stamp) cornerSash(ctx, W, H, d.stamp);
  };

  return { render, download, SIZES, onColor, shade, featureSlide, ctaSlide, signboard, openHomePost, arrowSign, opensRoundup, testimonial, prospectPost, agentPost };
})();
