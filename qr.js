/* Listing Kit — tiny self-contained QR Code generator (byte mode, ECC level M,
 * versions 1–10, automatic version + mask selection). No dependencies. Returns
 * a boolean module matrix you can paint onto a canvas. Implements the ISO 18004
 * algorithm: bitstream → Reed-Solomon ECC over GF(256) → interleave → matrix
 * (finder/timing/alignment/format/version) → best of 8 masks by penalty score. */
const QR = (() => {
  'use strict';
  // ---- GF(256) tables (primitive 0x11d) ----
  const EXP = new Array(512), LOG = new Array(256);
  (() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  // ---- per-(version, level M) block structure: [ecPerBlock, g1blocks, g1data, g2blocks, g2data] ----
  const ECC_M = {
    1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0],
    6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44],
  };
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
  const VERSION_INFO = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
  const dataCodewords = (v) => { const [ec, b1, d1, b2, d2] = ECC_M[v]; return b1 * d1 + b2 * d2; };

  const rsGenerator = (deg) => {
    let poly = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) { next[j] ^= gmul(poly[j], 1); next[j + 1] ^= gmul(poly[j], EXP[i]); }
      poly = next;
    }
    return poly;
  };
  const rsEncode = (data, ecLen) => {
    const gen = rsGenerator(ecLen), res = new Array(ecLen).fill(0);   // gen has ecLen+1 coeffs, gen[0]=1 (leading)
    for (const d of data) {
      const factor = d ^ res[0];
      res.shift(); res.push(0);
      if (factor !== 0) for (let j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
    }
    return res;
  };

  // ---- build the data+ecc codeword stream ----
  const buildCodewords = (bytes, v) => {
    const totalData = dataCodewords(v);
    const countBits = v >= 10 ? 16 : 8;
    // bit buffer
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    put(0b0100, 4);                 // byte mode
    put(bytes.length, countBits);   // char count
    for (const b of bytes) put(b, 8);
    // terminator + pad to byte boundary
    const cap = totalData * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    // bytes from bits
    const dc = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; dc.push(b); }
    // pad bytes
    const PAD = [0xEC, 0x11];
    let pi = 0;
    while (dc.length < totalData) dc.push(PAD[pi++ % 2]);

    // split into blocks, compute ECC
    const [ecLen, b1, d1, b2, d2] = ECC_M[v];
    const blocks = [], eccs = [];
    let p = 0;
    for (let i = 0; i < b1; i++) { const blk = dc.slice(p, p + d1); p += d1; blocks.push(blk); eccs.push(rsEncode(blk, ecLen)); }
    for (let i = 0; i < b2; i++) { const blk = dc.slice(p, p + d2); p += d2; blocks.push(blk); eccs.push(rsEncode(blk, ecLen)); }
    // interleave data then ecc
    const out = [];
    const maxD = Math.max(d1, d2);
    for (let i = 0; i < maxD; i++) for (const blk of blocks) if (i < blk.length) out.push(blk[i]);
    for (let i = 0; i < ecLen; i++) for (const ec of eccs) out.push(ec[i]);
    return out;
  };

  // ---- matrix construction ----
  const makeMatrix = (v, codewords) => {
    const size = v * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));   // null = free
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, val, res) => { m[r][c] = val ? 1 : 0; if (res) reserved[r][c] = true; };
    // finder pattern at (r,c)
    const finder = (r, c) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6));
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        set(rr, cc, inRing || inCore ? 1 : 0, true);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    // timing
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0 ? 1 : 0, true); set(i, 6, i % 2 === 0 ? 1 : 0, true); }
    // alignment
    const ac = ALIGN[v];
    for (const r of ac) for (const c of ac) {
      if ((r <= 7 && c <= 7) || (r <= 7 && c >= size - 8) || (r >= size - 8 && c <= 7)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        set(r + dr, c + dc, ring === 1 ? 0 : 1, true);
      }
    }
    // dark module
    set(size - 8, 8, 1, true);
    // reserve format info areas
    for (let i = 0; i < 9; i++) { if (!reserved[8][i]) reserved[8][i] = true; if (!reserved[i][8]) reserved[i][8] = true; }
    for (let i = 0; i < 8; i++) { reserved[8][size - 1 - i] = true; reserved[size - 1 - i][8] = true; }
    // reserve version info (v>=7)
    if (v >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { reserved[i][size - 11 + j] = true; reserved[size - 11 + j][i] = true; }

    // place data bits (zigzag, upward then downward) — return the matrix; masking applied after
    let bitIdx = 0;
    const allBits = [];
    for (const cw of codewords) for (let i = 7; i >= 0; i--) allBits.push((cw >> i) & 1);
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;   // skip timing column
      for (let n = 0; n < size; n++) {
        const row = upward ? size - 1 - n : n;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (reserved[row][cc]) continue;
          m[row][cc] = bitIdx < allBits.length ? allBits[bitIdx] : 0; bitIdx++;
        }
      }
      upward = !upward;
    }
    return { m, size, reserved };
  };

  const MASK = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];

  const applyMask = (m, reserved, size, maskNo) => {
    const out = m.map((row) => row.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!reserved[r][c] && MASK[maskNo](r, c)) out[r][c] ^= 1;
    return out;
  };

  // authoritative format-info strings for EC level M, mask 0..7 (BCH + 0x5412 applied)
  const FORMAT_M = [0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0];
  const placeFormat = (m, size, maskNo) => {
    const fmt = FORMAT_M[maskNo];
    const bit = (i) => (fmt >> (14 - i)) & 1;   // format string is placed MSB-first
    // around top-left
    for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
    m[8][7] = bit(6); m[8][8] = bit(7); m[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) m[14 - i][8] = bit(i);
    // second copy: bits 0-6 down col 8 (rows size-1..size-7), bits 7-14 along row 8 (cols size-8..size-1)
    for (let i = 0; i <= 6; i++) m[size - 1 - i][8] = bit(i);
    for (let i = 7; i <= 14; i++) m[8][size - 8 + (i - 7)] = bit(i);
  };
  const placeVersion = (m, size, v) => {
    if (v < 7) return;
    const info = VERSION_INFO[v];
    for (let i = 0; i < 18; i++) { const bit = (info >> i) & 1; const a = Math.floor(i / 3), b = i % 3; m[size - 11 + b][a] = bit; m[a][size - 11 + b] = bit; }
  };

  const penalty = (m, size) => {
    let score = 0;
    // rule 1: runs of 5+
    for (let r = 0; r < size; r++) for (let pass = 0; pass < 2; pass++) {
      let run = 1, prev = -1;
      for (let c = 0; c < size; c++) { const v = pass ? m[c][r] : m[r][c]; if (v === prev) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; } else { run = 1; prev = v; } }
    }
    // rule 2: 2x2 blocks
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) { const v = m[r][c]; if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3; }
    // rule 3: finder-like patterns
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let r = 0; r < size; r++) for (let c = 0; c < size - 10; c++) for (const seq of [pat1, pat2]) {
      let ok1 = true, ok2 = true;
      for (let k = 0; k < 11; k++) { if (m[r][c + k] !== seq[k]) ok1 = false; if (m[c + k] && m[c + k][r] !== seq[k]) ok2 = false; }
      if (ok1) score += 40; if (ok2) score += 40;
    }
    // rule 4: dark ratio
    let dark = 0; for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  };

  // public: encode(text) -> { size, modules:[[0|1]] }
  const encode = (text, forceMask) => {
    const bytes = [];
    for (const ch of unescape(encodeURIComponent(String(text)))) bytes.push(ch.charCodeAt(0));   // UTF-8
    // pick smallest version 1..10 that fits
    let v = 1; while (v <= 10) { const countBits = v >= 10 ? 16 : 8; const need = 4 + countBits + bytes.length * 8; if (need <= dataCodewords(v) * 8) break; v++; }
    if (v > 10) { v = 10; }   // clamp (URLs always fit by v10)
    const codewords = buildCodewords(bytes, v);
    const base = makeMatrix(v, codewords);
    // choose best mask
    let best = null, bestScore = Infinity, bestNo = 0;
    const maskRange = (typeof forceMask === 'number') ? [forceMask] : [0, 1, 2, 3, 4, 5, 6, 7];
    for (const maskNo of maskRange) {
      const masked = applyMask(base.m, base.reserved, base.size, maskNo);
      placeFormat(masked, base.size, maskNo);
      placeVersion(masked, base.size, v);
      const sc = penalty(masked, base.size);
      if (sc < bestScore) { bestScore = sc; best = masked; bestNo = maskNo; }
    }
    return { size: base.size, modules: best, version: v, mask: bestNo };
  };

  // paint onto a canvas context: black modules, given px size + origin, with quiet zone
  const draw = (ctx, text, x, y, sizePx, dark = '#000', light = '#fff') => {
    const qr = encode(text);
    const quiet = 4, total = qr.size + quiet * 2, cell = sizePx / total;
    ctx.fillStyle = light; ctx.fillRect(x, y, sizePx, sizePx);
    ctx.fillStyle = dark;
    for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.modules[r][c]) ctx.fillRect(x + (c + quiet) * cell, y + (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
    return qr;
  };

  return { encode, draw };
})();
