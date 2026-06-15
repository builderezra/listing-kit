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

  // cover-fit an image with a slow Ken-Burns zoom + pan over progress p (0..1)
  const coverKB = (ctx, img, p, variant, filter) => {
    if (!img || !img.width) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1d2a31'); g.addColorStop(1, '#0c161b');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); return;
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

  // record({canvas, brand, d, photos, opts, onProgress}) -> Promise<{blob, mime, ext}>
  const record = ({ canvas, brand, d, photos, opts, onProgress }) => new Promise((resolve, reject) => {
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
    pics.forEach((ph, i) => scenes.push({ type: 'photo', dur: o.perPhoto, photo: ph, caption: ph._caption || '', kb: i }));
    scenes.push({ type: 'outro', dur: o.outro });
    const total = scenes.reduce((s, sc) => s + sc.dur, 0);

    const paint = (sc, p) => {
      if (sc.type === 'intro') {
        const z = 1 + 0.05 * easeInOut(p), dw = W * z, dh = H * z;
        if (introImg.width) ctx.drawImage(introImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        return;
      }
      if (sc.type === 'outro') {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, Visuals.shade(brand.primary, 16)); g.addColorStop(1, Visuals.shade(brand.primary, -34));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        if (ctaImg.width) { const z = 1 + 0.05 * easeInOut(p), cw = W * z; ctx.drawImage(ctaImg, (W - cw) / 2, (H - cw) / 2, cw, cw); }
        return;
      }
      // photo scene
      coverKB(ctx, sc.photo && sc.photo.img, p, sc.kb, sc.photo && sc.photo.fcss);
      const g = ctx.createLinearGradient(0, H * 0.58, 0, H);
      g.addColorStop(0, 'rgba(8,14,18,0)'); g.addColorStop(1, 'rgba(8,14,18,0.84)');
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.58, W, H * 0.42);
      ctx.textAlign = 'left';
      let y = H - 150;
      if (sc.caption) {
        ctx.font = `800 60px ${SANS}`;
        const lines = wrap(ctx, sc.caption, W - 150, 3);
        y = H - 150 - (lines.length - 1) * 70;
        ctx.fillStyle = acc; ctx.fillRect(72, y - 78, 64, 6);
        ctx.fillStyle = '#fff';
        lines.forEach((l, i) => ctx.fillText(l, 72, y + i * 70));
      }
      if (brand.brokerage) { ctx.font = `600 30px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(brand.brokerage, 72, H - 70); }
      ctx.textAlign = 'left';
    };

    let stream, rec;
    try { stream = canvas.captureStream(FPS); rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 }); }
    catch (e) { return reject(e); }
    const chunks = [];
    let stopped = false, settled = false;
    const FRAME_MS = 1000 / FPS;
    const nowMs = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => { if (!settled) { settled = true; reject((e && e.error) || new Error('Recording failed.')); } };
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
      setTimeout(frame, FRAME_MS);
    };
    try { rec.start(1000); } catch (e) { return reject(e); }
    setTimeout(frame, 0);
  });

  // draw a single still frame (the intro) so the preview canvas isn't blank
  const previewFrame = (canvas, brand, d) => {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const off = document.createElement('canvas');
    try { Visuals.render(brand.templateId, 'story', off, d); ctx.drawImage(off, 0, 0); } catch (e) {}
  };

  return { record, supported, pickMime, ext, previewFrame };
})();
