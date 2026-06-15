/* Listing Kit — animated Reel / Story video, built entirely on-device.
 *
 * Composites the listing photos into a vertical 1080×1920 clip: a branded intro
 * card (the chosen template), Ken-Burns photo scenes with crossfades + captions,
 * and a call-to-action outro. Recorded straight off a <canvas> via captureStream
 * + MediaRecorder — no upload, no library. Prefers MP4 (Safari) and falls back to
 * WebM (Chrome/Firefox); the UI tells the agent which they got.
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
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const rgba = (hex, a) => {
    let h = String(hex || '#0f2e3d').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const SANS = `-apple-system, 'Helvetica Neue', 'Segoe UI', Arial, sans-serif`;

  // cover-fit an image with a slow Ken-Burns zoom + pan over progress p (0..1).
  // fit=true instead shows the WHOLE photo (contain) over a blurred fill so nothing
  // important is cropped — only a very gentle zoom.
  const coverKB = (ctx, img, p, variant, filter, fit) => {
    if (!img || !img.width) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1d2a31'); g.addColorStop(1, '#0c161b');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return;
    }
    if (fit) {
      // blurred, darkened cover behind (fills the letterbox tastefully)
      const cs = Math.max(W / img.width, H / img.height) * 1.12;
      const cw = img.width * cs, ch = img.height * cs;
      ctx.save();
      try { ctx.filter = 'blur(38px) brightness(0.55)'; } catch (e) {}
      ctx.drawImage(img, (W - cw) / 2, (H - ch) / 2, cw, ch);
      ctx.restore();
      // whole photo, contained, with a gentle zoom only
      const fs = Math.min(W / img.width, H / img.height) * (1.0 + 0.05 * easeInOut(p));
      const dw = img.width * fs, dh = img.height * fs;
      if (filter) { try { ctx.filter = filter; } catch (e) {} }
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      ctx.filter = 'none';
      return;
    }
    const baseS = Math.max(W / img.width, H / img.height);
    const s = baseS * (1.06 + 0.16 * easeInOut(p));
    const dw = img.width * s, dh = img.height * s;
    const anchors = [[0.5, 0.42], [0.42, 0.5], [0.58, 0.5], [0.5, 0.58]];
    const [ax, ay] = anchors[variant % 4];
    const drift = 0.05 * (variant % 2 ? -1 : 1) * easeInOut(p);
    const dx = (W - dw) * clamp01(ax + drift);
    const dy = (H - dh) * clamp01(ay - drift);
    if (filter) { try { ctx.filter = filter; } catch (e) {} }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.filter = 'none';
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
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // one cinematic photo scene: Ken-Burns image + vignette + bottom scrim + an
  // animated lower-third (accent bar + caption that slides up & fades in/out).
  const paintPhotoScene = (ctx, o2) => {
    const { img, fcss, caption, kb, p, dur, counter, brokerage, acc, fit } = o2;
    coverKB(ctx, img, p, kb || 0, fcss, fit);
    const vg = ctx.createRadialGradient(W / 2, H * 0.42, H * 0.22, W / 2, H * 0.5, H * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.5, 0, H);
    g.addColorStop(0, 'rgba(8,12,16,0)'); g.addColorStop(1, 'rgba(8,12,16,0.92)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.5, W, H * 0.5);
    const localT = p * dur;
    if (caption) {
      const appear = easeOut(clamp01(localT / 0.5));
      const alpha = Math.min(appear, clamp01((dur - localT) / 0.35));
      const slide = (1 - appear) * 48;
      ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = 'left';
      ctx.font = `800 62px ${SANS}`;
      const lines = wrap(ctx, caption, W - 168, 2);
      const baseY = H - 156 + slide - (lines.length - 1) * 74;
      ctx.fillStyle = acc; ctx.fillRect(74, baseY - 88, 72, 7);
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 2;
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

  // record({canvas, brand, d, photos, opts, onProgress}) -> Promise<{blob, mime, ext}>
  const record = ({ canvas, brand, d, photos, captions, opts, onProgress }) => new Promise((resolve, reject) => {
    const mime = pickMime();
    if (!mime) return reject(new Error('Video recording isn’t supported in this browser.'));
    const o = Object.assign({ intro: 2.6, perPhoto: 2.6, outro: 3.0, xf: 0.5 }, opts || {});
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const acc = brand.accent || '#c08a3e';

    // pre-render the branded intro (story template) + CTA outro card once
    const introImg = document.createElement('canvas');
    try { Visuals.render(brand.templateId, 'story', introImg, d); } catch (e) {}
    const ctaImg = document.createElement('canvas');
    try { Visuals.ctaSlide(ctaImg, { brand, address: d.address, badgeText: d.badgeText, ohLine: d.ohLine }); } catch (e) {}

    const pics = (photos || []).slice(0, 6);
    const scenes = [{ type: 'intro', dur: o.intro }];
    pics.forEach((ph, i) => scenes.push({ type: 'photo', dur: o.perPhoto, photo: ph, caption: (captions && captions[i] != null) ? captions[i] : (ph._caption || ''), kb: i }));
    scenes.push({ type: 'outro', dur: o.outro });
    const total = scenes.reduce((s, sc) => s + sc.dur, 0);

    const paint = (sc, p) => {
      if (sc.type === 'intro') {
        const z = 1 + 0.06 * easeInOut(p), dw = W * z, dh = H * z;
        if (introImg.width) ctx.drawImage(introImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        const fin = clamp01(p * sc.dur / 0.45);               // open with a fade-in from black
        if (fin < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fin})`; ctx.fillRect(0, 0, W, H); }
        return;
      }
      if (sc.type === 'outro') {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, Visuals.shade(brand.primary, 16)); g.addColorStop(1, Visuals.shade(brand.primary, -34));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        if (ctaImg.width) {
          const cardA = easeOut(clamp01(p * sc.dur / 0.45)), z = 1.03 - 0.03 * cardA, cw = W * z;
          ctx.save(); ctx.globalAlpha = cardA; ctx.drawImage(ctaImg, (W - cw) / 2, (H - cw) / 2, cw, cw); ctx.restore();
        }
        const localT = p * sc.dur, fout = clamp01((localT - (sc.dur - 0.4)) / 0.4);   // close with a fade-to-black
        if (fout > 0) { ctx.fillStyle = `rgba(0,0,0,${fout})`; ctx.fillRect(0, 0, W, H); }
        return;
      }
      // cinematic photo scene
      paintPhotoScene(ctx, {
        img: sc.photo && sc.photo.img, fcss: sc.photo && sc.photo.fcss, caption: sc.caption,
        kb: sc.kb, p, dur: sc.dur, counter: `${(sc.kb || 0) + 1} / ${pics.length}`,
        brokerage: brand.brokerage, acc, fit: o.fit,
      });
    };

    let stream, rec;
    try { stream = canvas.captureStream(FPS); rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 }); }
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
    // backstop: never hang past the timeline (e.g. if the tab is hidden mid-render)
    const watchdog = setTimeout(finish, (total + 5) * 1000);
    // timer-driven (not rAF) so it still completes if the tab is backgrounded
    const start = nowMs();
    const frame = () => {
      if (stopped) return;
      const t = (nowMs() - start) / 1000;
      if (onProgress) { try { onProgress(clamp01(t / total), t, total); } catch (e) {} }
      let i = 0, base = 0;
      while (i < scenes.length && t >= base + scenes[i].dur) { base += scenes[i].dur; i++; }
      if (i >= scenes.length) { clearTimeout(watchdog); finish(); return; }
      const sc = scenes[i], localT = t - base, p = clamp01(localT / sc.dur);
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = 1; paint(sc, p);
      const remain = sc.dur - localT;
      if (remain < o.xf && i + 1 < scenes.length) { ctx.globalAlpha = clamp01((o.xf - remain) / o.xf); paint(scenes[i + 1], 0); ctx.globalAlpha = 1; }
      drawProgress(ctx, scenes.length, i, p);
      setTimeout(frame, FRAME_MS);
    };
    try { rec.start(1000); } catch (e) { return reject(e); }
    setTimeout(frame, 0);
  });

  // draw a single still frame (the intro) so the preview canvas isn't blank
  const previewFrame = (canvas, brand, d) => {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const hero = d && d.hero;
    if (hero && hero.width) {   // show a real cinematic photo frame so the preview reflects the reel
      const n = Math.max(1, ((d.photos || []).filter((x) => x.inCarousel !== false).length) || 1);
      const cap = d.price ? (d.price + (d.address ? '  ·  ' + d.address : '')) : (d.address || 'Your next home');
      paintPhotoScene(ctx, { img: hero, fcss: d.heroFilter, caption: cap, kb: 0, p: 0.62, dur: 2.6, counter: '01 / ' + n, brokerage: brand.brokerage, acc: brand.accent || '#c08a3e', fit: false });
      drawProgress(ctx, n + 2, 1, 0.5);
      return;
    }
    const off = document.createElement('canvas');
    try { Visuals.render(brand.templateId, 'story', off, d); ctx.drawImage(off, 0, 0); } catch (e) {}
  };

  return { record, supported, pickMime, ext, previewFrame };
})();
