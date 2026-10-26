/** Pure helpers shared by the DEV package downloader and its Node tests. */
const MD5_K = Uint32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0);
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const rotl = (x, n) => (x << n) | (x >>> (32 - n));

/** MD5 for package de-duplication only; SHA-256 remains the integrity authority. */
export function md5Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes); padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setBigUint64(paddedLength - 8, BigInt(bytes.length) * 8n, true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const view = new DataView(padded.buffer);
  for (let off = 0; off < paddedLength; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g, shift;
      if (i < 16) { f = (b & c) | (~b & d); g = i; shift = MD5_S[i % 4]; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; shift = MD5_S[4 + (i % 4)]; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; shift = MD5_S[8 + (i % 4)]; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; shift = MD5_S[12 + (i % 4)]; }
      const sum = (a + f + MD5_K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      a = d; d = c; c = b; b = (b + rotl(sum, shift)) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].flatMap((v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255])
    .map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function shouldSkipPackFile({ existingSize, existingHash, record }) {
  if (!record || !Number.isSafeInteger(existingSize) || existingSize !== record.size || typeof existingHash !== 'string') return false;
  const expected = record.md5 || record.sha256;
  return typeof expected === 'string' && existingHash.toLowerCase() === expected.toLowerCase();
}

export function createByteProgress(records) {
  const total = records.reduce((sum, rec) => sum + (Number.isSafeInteger(rec?.size) && rec.size > 0 ? rec.size : 0), 0);
  return { total, done: 0, skipped: 0, filesDone: 0 };
}

export function recordPackFileDone(progress, size, { skipped = false } = {}) {
  const bytes = Number.isSafeInteger(size) && size > 0 ? size : 0;
  progress.done = Math.min(progress.total, progress.done + bytes);
  progress.filesDone++;
  if (skipped) progress.skipped++;
  return progress;
}

export function byteProgressFraction(progress, inFlight = 0) {
  if (!progress.total) return 1;
  return Math.max(0, Math.min(1, (progress.done + Math.max(0, inFlight)) / progress.total));
}

