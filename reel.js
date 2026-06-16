/* Listing Kit — animated Reel / Story video, built entirely on-device.
 *
 * Composites the listing photos into a vertical 1080×1920 clip: a branded intro
 * card (the chosen template), photo scenes with VARIED constant-velocity camera
 * moves, mixed transitions (dissolve / dip / push), a rhythmic pace and a light
 * film grain so it reads hand-cut rather than templated; ends on a CTA outro.
 * Recorded straight off a <canvas> via captureStream + MediaRecorder — no upload,
 * no library. Prefers MP4 (Safari), falls back to WebM (Chrome/Firefox).
 */
const Reel = (() => {
  'use strict';
  const W = 1080, H = 1920, FPS = 30;

  const MIMES = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const pickMime = () => {
    for (const m of MIMES) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return '';
  };
  const supported = () => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && pickMime());
  const ext = (mime) => (mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm');

  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const SANS = `-apple-system, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif`;

  // ---- camera moves: each is a constant-velocity glide (start→end) so the motion
  // feels like a real slider/gimbal instead of the easeInOut "breathing" that stalls
  // at every cut. A different move is assigned to each consecutive photo. ----
  const MOVES = [
    { s0: 1.06, s1: 1.22, cx0: 0.50, cy0: 0.44, cx1: 0.50, cy1: 0.46 },   // slow push-in
    { s0: 1.24, s1: 1.07, cx0: 0.50, cy0: 0.50, cx1: 0.50, cy1: 0.48 },   // pull-out reveal
    { s0: 1.13, s1: 1.13, cx0: 0.36, cy0: 0.50, cx1: 0.64, cy1: 0.50 },   // pan right
    { s0: 1.13, s1: 1.13, cx0: 0.64, cy0: 0.50, cx1: 0.36, cy1: 0.50 },   // pan left
    { s0: 1.15, s1: 1.15, cx0: 0.50, cy0: 0.64, cx1: 0.50, cy1: 0.38 },   // tilt up (reveal)
    { s0: 1.08, s1: 1.20, cx0: 0.40, cy0: 0.56, cx1: 0.58, cy1: 0.44 },   // diagonal push
    { s0: 1.20, s1: 1.08, cx0: 0.58, cy0: 0.44, cx1: 0.42, cy1: 0.56 },   // diagonal pull
  ];
  // draw img cover-fit with a given scale + focal point (image point shown at frame centre)
  const drawFocal = (ctx, img, scale, cx, cy, filter) => {
    const base = Math.max(W / img.width, H / img.height) * scale;
    const dw = img.width * base, dh = img.height * base;
    let dx = W / 2 - cx * dw, dy = H / 2 - cy * dh;
    dx = Math.min(0, Math.max(W - dw, dx)); dy = Math.min(0, Math.max(H - dh, dy));   // keep frame covered
    if (filter) { try { ctx.filter = filter; } catch (e) {} }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.filter = 'none';
  };
  // a photo for one scene: either a varied camera move, or (fit) the whole frame
  // over a blurred fill with only a gentle push so nothing important is cropped.
  const paintImage = (ctx, img, p, moveIdx, filter, fit) => {
    if (!img || !img.width) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1d2a31'); g.addColorStop(1, '#0c161b');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return;
    }
    if (fit) {
      const cs = Math.max(W / img.width, H / img.height) * 1.12;
      const cw = img.width * cs, ch = img.height * cs;
      ctx.save(); try { ctx.filter = 'blur(38px) brightness(0.55)'; } catch (e) {}
      ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch); ctx.restore();
      const fs = Math.min(W / img.width, H / img.height) * (1.0 + 0.05 * p);
      const dw = img.width * fs, dh = img.height * fs;
      if (filter) { try { ctx.filter = filter; } catch (e) {} }
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); ctx.filter = 'none';
      return;
    }
    const mv = MOVES[((moveIdx % MOVES.length) + MOVES.length) % MOVES.length];
    const s = mv.s0 + (mv.s1 - mv.s0) * p;          // linear = constant velocity (smooth glide)
    const cx = mv.cx0 + (mv.cx1 - mv.cx0) * p;
    const cy = mv.cy0 + (mv.cy1 - mv.cy0) * p;
    drawFocal(ctx, img, s, cx, cy, filter);
  };

  // ---- film grain: one oversized noise tile, drawn through a random window each
  // frame (animated grain) at low opacity. Built once, cached. ----
  let grainTile = null;
  const getGrain = () => {
    if (grainTile) return grainTile;
    const gw = 540, gh = 960;                       // half-res tile, scaled up when drawn (cheap)
    const c = document.createElement('canvas'); c.width = gw; c.height = gh;
    const cx = c.getContext('2d'); const id = cx.createImageData(gw, gh); const d = id.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    cx.putImageData(id, 0, 0); grainTile = c; return c;
  };
  const drawGrain = (ctx, amt) => {
    const g = getGrain();
    const ox = (Math.random() * (g.width * 0.25)) | 0, oy = (Math.random() * (g.height * 0.25)) | 0;
    ctx.save(); ctx.globalAlpha = amt; ctx.globalCompositeOperation = 'overlay';
    ctx.drawImage(g, ox, oy, g.width * 0.75, g.height * 0.75, 0, 0, W, H);
    ctx.restore();
  };

  // wrap text to <=maxLines lines within maxW (returns the lines)
  const wrap = (ctx, text, maxW, maxLines) => {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = []; let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; if (lines.length === maxLines) break; }
      else line = t;
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
  };

  // one photo scene: camera move + cinematic grade (vignette, bottom scrim, grain)
  // + an animated lower-third (accent bar + caption sliding up & fading in/out).
  const paintPhotoScene = (ctx, o2) => {
    const { img, fcss, caption, move, p, dur, counter, brokerage, acc, fit, grain } = o2;
    paintImage(ctx, img, p, move || 0, fcss, fit);
    const vg = ctx.createRadialGradient(W / 2, H * 0.40, H * 0.20, W / 2, H * 0.5, H * 0.82);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.48, 0, H);
    g.addColorStop(0, 'rgba(8,12,16,0)'); g.addColorStop(1, 'rgba(8,12,16,0.92)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.46, W, H * 0.54);
    if (grain) drawGrain(ctx, grain);
    const localT = p * dur;
    if (caption) {
      const appear = easeOut(clamp01(localT / 0.55));
      const alpha = Math.min(appear, clamp01((dur - localT) / 0.4));
      const slide = (1 - appear) * 54;
      ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = 'left';
      ctx.font = `800 62px ${SANS}`;
      const lines = wrap(ctx, caption, W - 168, 2);
      const baseY = H - 158 + slide - (lines.length - 1) * 74;
      ctx.fillStyle = acc; ctx.fillRect(74, baseY - 90, 74, 7);
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 2;
      ctx.fillStyle = '#fff';
      lines.forEach((l, i) => ctx.fillText(l, 74, baseY + i * 74));
      ctx.restore();
    }
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 8;
    if (brokerage) { ctx.textAlign = 'left'; ctx.font = `600 28px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.74)'; ctx.fillText(brokerage, 74, H - 64); }
    if (counter) { ctx.textAlign = 'right'; ctx.font = `700 26px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillText(counter, W - 64, H - 64); }
    ctx.restore();
  };

  // story-style segmented progress bar across the top
  const drawProgress = (ctx, n, idx, p) => {
    if (n < 1) return;
    const m = 40, gap = 8, y = 28, h = 5, segW = (W - m * 2 - gap * (n - 1)) / n;
    for (let s = 0; s < n; s++) {
      const x = m + s * (segW + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.30)'; ctx.fillRect(x, y, segW, h);
      const f = s < idx ? 1 : (s === idx ? clamp01(p) : 0);
      if (f > 0) { ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(x, y, segW * f, h); }
    }
  };

  // rhythmic pacing: vary each photo's hold so the cut isn't metronomic. The hero
  // (first) lingers; the montage in the middle is a touch quicker.
  const RHYTHM = [1.18, 0.92, 1.04, 0.88, 1.1, 0.96, 1.0];
  // mixed transitions so consecutive cuts differ (reads "edited", not auto-generated)
  const TRANSITIONS = ['dissolve', 'push', 'dip', 'dissolve', 'pushUp', 'dipwhite'];

  // record({canvas, brand, d, photos, captions, opts, onProgress}) -> Promise<{blob, mime, ext}>
  const record = ({ canvas, brand, d, photos, captions, opts, onProgress }) => new Promise((resolve, reject) => {
    const mime = pickMime();
    if (!mime) return reject(new Error('Video recording isn’t supported in this browser.'));
    const o = Object.assign({ intro: 2.6, perPhoto: 2.6, outro: 3.0, xf: 0.55, grain: 0.05 }, opts || {});
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const acc = brand.accent || '#c08a3e';

    // pre-render the branded intro (story template) + CTA outro card once
    const introImg = document.createElement('canvas');
    try { Visuals.render(brand.templateId, 'story', introImg, d); } catch (e) {}
    const ctaImg = document.createElement('canvas');
    try { Visuals.ctaSlide(ctaImg, { brand, address: d.address, badgeText: d.badgeText, ohLine: d.ohLine }); } catch (e) {}

    const pics = (photos || []).slice(0, 6);
    const scenes = [{ type: 'intro', dur: o.intro, transOut: 'dissolve', xfOut: 0.5 }];
    pics.forEach((ph, i) => scenes.push({
      type: 'photo',
      dur: Math.max(1.6, o.perPhoto * RHYTHM[i % RHYTHM.length]),
      photo: ph,
      caption: (captions && captions[i] != null) ? captions[i] : (ph._caption || ''),
      move: (i * 2 + (i % 3)) % MOVES.length,                        // spread the moves so neighbours differ
      transOut: (i === pics.length - 1) ? 'dissolve' : TRANSITIONS[i % TRANSITIONS.length],
      xfOut: 0.5,
    }));
    scenes.push({ type: 'outro', dur: o.outro });
    const total = scenes.reduce((s, sc) => s + sc.dur, 0);

    const paint = (sc, p) => {
      if (sc.type === 'intro') {
        const z = 1 + 0.07 * p, dw = W * z, dh = H * z;                // gentle constant push on the brand card
        if (introImg.width) ctx.drawImage(introImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        if (o.grain) drawGrain(ctx, o.grain * 0.7);
        const fin = clamp01(p * sc.dur / 0.45);                       // open with a fade-in from black
        if (fin < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fin})`; ctx.fillRect(0, 0, W, H); }
        return;
      }
      if (sc.type === 'outro') {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, Visuals.shade(brand.primary, 16)); g.addColorStop(1, Visuals.shade(brand.primary, -34));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        if (ctaImg.width) {
          const cardA = easeOut(clamp01(p * sc.dur / 0.5)), z = 1.04 - 0.04 * cardA, cw = W * z;
          ctx.save(); ctx.globalAlpha = cardA; ctx.drawImage(ctaImg, (W - cw) / 2, (H - cw) / 2, cw, cw); ctx.restore();
        }
        if (o.grain) drawGrain(ctx, o.grain * 0.7);
        const localT = p * sc.dur, fout = clamp01((localT - (sc.dur - 0.4)) / 0.4);   // close with a fade-to-black
        if (fout > 0) { ctx.fillStyle = `rgba(0,0,0,${fout})`; ctx.fillRect(0, 0, W, H); }
        return;
      }
      paintPhotoScene(ctx, {
        img: sc.photo && sc.photo.img, fcss: sc.photo && sc.photo.fcss, caption: sc.caption,
        move: sc.move, p, dur: sc.dur, counter: `${(scenes.indexOf(sc))} / ${pics.length}`,
        brokerage: brand.brokerage, acc, fit: o.fit, grain: o.grain,
      });
    };

    let stream, rec;
    try { stream = canvas.captureStream(FPS); rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 9000000 }); }
    catch (e) { return reject(e); }
    const chunks = [];
    let stopped = false, settled = false;
    const FRAME_MS = 1000 / FPS;
    const nowMs = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => { stopped = true; clearTimeout(watchdog); if (!settled) { settled = true; reject((e && e.error) || new Error('Recording failed.')); } };
    rec.onstop = () => {
      if (settled) return; settled = true;
      if (!chunks.length) reject(new Error('Your browser produced an empty video — try Chrome or Safari, and keep this tab in front while it renders.'));
      else resolve({ blob: new Blob(chunks, { type: mime.split(';')[0] }), mime, ext: ext(mime) });
    };
    const finish = () => { if (stopped) return; stopped = true; try { rec.stop(); } catch (e) {} };
    const watchdog = setTimeout(finish, (total + 5) * 1000);
    const start = nowMs();
    // a transition between scene i (outgoing, progress p) and the next scene
    const composite = (i, sc, p, tp) => {
      const next = scenes[i + 1]; const trans = sc.transOut || 'dissolve';
      if (trans === 'push') {
        const e = easeInOut(tp), off = e * W;
        ctx.save(); ctx.translate(-off, 0); paint(sc, p); ctx.restore();
        ctx.save(); ctx.translate(W - off, 0); paint(next, 0); ctx.restore();
      } else if (trans === 'pushUp') {
        const e = easeInOut(tp), off = e * H;
        ctx.save(); ctx.translate(0, -off); paint(sc, p); ctx.restore();
        ctx.save(); ctx.translate(0, H - off); paint(next, 0); ctx.restore();
      } else if (trans === 'dip' || trans === 'dipwhite') {
        const col = trans === 'dipwhite' ? '255,255,255' : '0,0,0';
        if (tp < 0.5) { paint(sc, p); ctx.fillStyle = `rgba(${col},${clamp01(tp * 2)})`; ctx.fillRect(0, 0, W, H); }
        else { paint(next, 0); ctx.fillStyle = `rgba(${col},${clamp01((1 - tp) * 2)})`; ctx.fillRect(0, 0, W, H); }
      } else {   // dissolve
        paint(sc, p); ctx.globalAlpha = easeInOut(tp); paint(next, 0); ctx.globalAlpha = 1;
      }
    };
    const frame = () => {
      if (stopped) return;
      const t = (nowMs() - start) / 1000;
      if (onProgress) { try { onProgress(clamp01(t / total), t, total); } catch (e) {} }
      let i = 0, base = 0;
      while (i < scenes.length && t >= base + scenes[i].dur) { base += scenes[i].dur; i++; }
      if (i >= scenes.length) { clearTimeout(watchdog); finish(); return; }
      const sc = scenes[i], localT = t - base, p = clamp01(localT / sc.dur);
      ctx.clearRect(0, 0, W, H); ctx.globalAlpha = 1;
      const remain = sc.dur - localT, xf = sc.xfOut || o.xf;
      if (remain < xf && i + 1 < scenes.length) composite(i, sc, p, clamp01((xf - remain) / xf));
      else paint(sc, p);
      // progress bar (faded with the intro/outro black so it doesn't pop)
      const lt = p * sc.dur;
      const barFade = sc.type === 'intro' ? clamp01(lt / 0.45) : (sc.type === 'outro' ? 1 - clamp01((lt - (sc.dur - 0.4)) / 0.4) : 1);
      ctx.globalAlpha = barFade; drawProgress(ctx, scenes.length, i, p); ctx.globalAlpha = 1;
      setTimeout(frame, FRAME_MS);
    };
    try { rec.start(1000); } catch (e) { return reject(e); }
    setTimeout(frame, 0);
  });

  // draw a single still frame (a representative photo scene) so the preview isn't blank
  const previewFrame = (canvas, brand, d) => {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const hero = d && d.hero;
    if (hero && hero.width) {
      const n = Math.min(6, Math.max(1, ((d.photos || []).filter((x) => x.inCarousel !== false).length) || 1));   // the reel caps photo scenes at 6
      const cap = d.price ? (d.price + (d.address ? '  ·  ' + d.address : '')) : (d.address || 'Your next home');
      paintPhotoScene(ctx, { img: hero, fcss: d.heroFilter, caption: cap, move: 0, p: 0.5, dur: 2.6, counter: '1 / ' + n, brokerage: brand.brokerage, acc: brand.accent || '#c08a3e', fit: false, grain: 0.05 });
      drawProgress(ctx, n + 2, 1, 0.5);
      return;
    }
    const off = document.createElement('canvas');
    try { Visuals.render(brand.templateId, 'story', off, d); ctx.drawImage(off, 0, 0); } catch (e) {}
  };

  return { record, supported, pickMime, ext, previewFrame };
})();
