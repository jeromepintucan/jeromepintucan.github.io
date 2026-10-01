/**
 * Self-contained cryptographic primitives (SHA-256, SHA-1, HMAC, PBKDF2) so the demo works from file://
 * and in any browser without relying on SubtleCrypto availability. Verified against Node's crypto module
 * in tests/crypto.test.ts.
 *
 * Production note: the production API uses Argon2id for passwords and platform crypto libraries; these
 * implementations exist so the demo never stores plain-text passwords or unsigned tokens.
 */

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ---------------------------------------------------------------- SHA-256

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const H256 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

function pad64(message: Uint8Array): Uint8Array {
  const bitLen = message.length * 8;
  const withOne = message.length + 1;
  const total = Math.ceil((withOne + 8) / 64) * 64;
  const out = new Uint8Array(total);
  out.set(message);
  out[message.length] = 0x80;
  const view = new DataView(out.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(total - 4, bitLen >>> 0);
  return out;
}

export function sha256(message: Uint8Array): Uint8Array {
  const data = pad64(message);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const h = H256.slice();
  const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

// ---------------------------------------------------------------- SHA-1 (TOTP compatibility only)

export function sha1(message: Uint8Array): Uint8Array {
  const data = pad64(message);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) >>> 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}

// ---------------------------------------------------------------- HMAC / PBKDF2

type HashFn = (m: Uint8Array) => Uint8Array;

export function hmac(hash: HashFn, key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockSize = 64;
  const k = key.length > blockSize ? hash(key) : key;
  const padded = new Uint8Array(blockSize);
  padded.set(k);
  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = padded[i]! ^ 0x36;
    opad[i] = padded[i]! ^ 0x5c;
  }
  return hash(concatBytes(opad, hash(concatBytes(ipad, message))));
}

export function hmacSha256(key: Uint8Array | string, message: Uint8Array | string): Uint8Array {
  return hmac(sha256, typeof key === 'string' ? utf8(key) : key, typeof message === 'string' ? utf8(message) : message);
}

export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha1, key, message);
}

/** One SHA-256 compression over w[0..15] (w must have length 64); updates `h` in place. */
function compress256(h: Uint32Array, w: Uint32Array): void {
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15]!;
    const y = w[i - 2]!;
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
  }
  let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K256[i]! + w[i]!) >>> 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
    hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
  h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
}

/**
 * PBKDF2-HMAC-SHA256 (RFC 8018). Uses precomputed HMAC inner/outer states so each iteration costs two
 * compressions and no allocations.
 */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, keyLength: number): Uint8Array {
  const key = password.length > 64 ? sha256(password) : password;
  const padded = new Uint8Array(64);
  padded.set(key);
  const w = new Uint32Array(64);
  const istate = new Uint32Array(H256);
  const ostate = new Uint32Array(H256);
  const pv = new DataView(padded.buffer);
  for (let i = 0; i < 16; i++) w[i] = (pv.getUint32(i * 4) ^ 0x36363636) >>> 0;
  compress256(istate, w);
  for (let i = 0; i < 16; i++) w[i] = (pv.getUint32(i * 4) ^ 0x5c5c5c5c) >>> 0;
  compress256(ostate, w);

  const blocks = Math.ceil(keyLength / 32);
  const out = new Uint8Array(blocks * 32);
  const ov = new DataView(out.buffer);
  const u = new Uint32Array(8);
  const t = new Uint32Array(8);
  const st = new Uint32Array(8);
  for (let block = 1; block <= blocks; block++) {
    const counter = new Uint8Array([(block >>> 24) & 0xff, (block >>> 16) & 0xff, (block >>> 8) & 0xff, block & 0xff]);
    const first = hmacSha256(password, concatBytes(salt, counter));
    const fv = new DataView(first.buffer, first.byteOffset, 32);
    for (let i = 0; i < 8; i++) { u[i] = fv.getUint32(i * 4); t[i] = u[i]!; }
    for (let iter = 1; iter < iterations; iter++) {
      // inner = SHA256(ipad || u)
      st.set(istate);
      for (let i = 0; i < 8; i++) w[i] = u[i]!;
      w[8] = 0x80000000; w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0; w[15] = 768;
      compress256(st, w);
      // u = SHA256(opad || inner)
      for (let i = 0; i < 8; i++) w[i] = st[i]!;
      w[8] = 0x80000000; w[9] = 0; w[10] = 0; w[11] = 0; w[12] = 0; w[13] = 0; w[14] = 0; w[15] = 768;
      st.set(ostate);
      compress256(st, w);
      for (let i = 0; i < 8; i++) { u[i] = st[i]!; t[i] = (t[i]! ^ u[i]!) >>> 0; }
    }
    for (let i = 0; i < 8; i++) ov.setUint32((block - 1) * 32 + i * 4, t[i]!);
  }
  return out.slice(0, keyLength);
}

// ---------------------------------------------------------------- encodings

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new RangeError('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += B64URL[n & 63]!;
  }
  return out;
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding (authenticator-app secrets). */
export function toBase32(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new RangeError('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------- randomness & comparison

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Constant-time comparison for secrets of equal length. */
export function timingSafeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  const x = typeof a === 'string' ? utf8(a) : a;
  const y = typeof b === 'string' ? utf8(b) : b;
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function sha256Hex(text: string): string {
  return toHex(sha256(utf8(text)));
}

/** Stable JSON (sorted keys) for hashing snapshots and audit records. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

// ---------------------------------------------------------------- password hashing (demo)

/** Demo parameters (~60 ms in a browser). Production: Argon2id server-side (design doc 14). */
export const DEMO_PBKDF2_ITERATIONS = 100_000;

/** PHC-style string: $pbkdf2-sha256$i=100000$<salt b64url>$<hash b64url> */
export function hashPassword(password: string, iterations = DEMO_PBKDF2_ITERATIONS, salt: Uint8Array = randomBytes(16)): string {
  const dk = pbkdf2Sha256(utf8(password.normalize('NFKC')), salt, iterations, 32);
  return `$pbkdf2-sha256$i=${iterations}$${toBase64Url(salt)}$${toBase64Url(dk)}`;
}

function fromBase64Url(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of text) {
    const idx = B64URL.indexOf(ch);
    if (idx < 0) throw new RangeError('invalid base64url');
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function verifyPassword(password: string, phc: string): boolean {
  const parts = phc.split('$');
  if (parts.length !== 5 || parts[1] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[2]!.replace('i=', ''));
  if (!Number.isInteger(iterations) || iterations < 1_000) return false;
  const salt = fromBase64Url(parts[3]!);
  const expected = fromBase64Url(parts[4]!);
  const actual = pbkdf2Sha256(utf8(password.normalize('NFKC')), salt, iterations, expected.length);
  return timingSafeEqual(actual, expected);
}

/** Opaque token + its SHA-256 digest (only the digest is stored server-side). */
export function newOpaqueToken(bytes = 32): { token: string; digest: string } {
  const token = toBase64Url(randomBytes(bytes));
  return { token, digest: sha256Hex(token) };
}
