/* Listing Kit — tiny dependency-free ZIP writer.
 *
 * Builds a valid .zip Blob entirely in the browser using the STORE method (no
 * compression). PNG/JPEG are already compressed, so storing them adds no real
 * size cost, and avoiding DEFLATE keeps this to ~70 lines with zero deps —
 * nothing leaves the device. Pass [{ name, data }] where data is a Uint8Array
 * or a string (UTF-8 encoded for you). Sub-folders: put "/" in the name.
 */
const Zip = (() => {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  const enc = (s) => new TextEncoder().encode(s);
  const concat = (parts) => {
    let len = 0;
    parts.forEach((p) => (len += p.length));
    const out = new Uint8Array(len);
    let o = 0;
    parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  };
  const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  // DOS date/time stamp from a JS Date (so the archive carries the real date)
  const dosStamp = (date) => {
    const d = date || new Date();
    const y = Math.max(1980, d.getFullYear());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
    const day = ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xffff, date: day & 0xffff };
  };

  // files: [{ name, data: Uint8Array|string }] -> Blob
  const build = (files) => {
    const { time, date } = dosStamp();
    const body = [];     // local headers + file data, in order
    const central = [];  // central-directory records
    let offset = 0;
    files.forEach((f) => {
      const nameBytes = enc(f.name);
      const data = typeof f.data === 'string' ? enc(f.data) : f.data;
      const crc = crc32(data);
      const size = data.length;
      const lfh = concat([
        u32(0x04034b50), u16(20), u16(0), u16(0),   // sig, version, flags, method=store
        u16(time), u16(date), u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0), nameBytes,
      ]);
      body.push(lfh, data);
      central.push(concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0),  // sig, made-by, needed, flags, method
        u16(time), u16(date), u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),  // name, extra, comment, disk, int-attrs
        u32(0), u32(offset), nameBytes,
      ]));
      offset += lfh.length + size;
    });
    const cd = concat(central);
    const eocd = concat([
      u32(0x06054b50), u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(cd.length), u32(offset), u16(0),
    ]);
    return new Blob([...body, cd, eocd], { type: 'application/zip' });
  };

  return { build, crc32 };
})();
