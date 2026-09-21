// AES-CTR inlined implementation for Sắc Hiệp Viện plugin
const BLOCK_SIZE = 16;
const BLOCK_SIZE32 = 4;
const POLY = 283;

function validateKeyLength(key: Uint8Array) {
  if (![16, 24, 32].includes(key.length)) {
    throw new Error(
      '"aes key" expected Uint8Array of length 16/24/32, got length=' +
        key.length,
    );
  }
}

function mul2(n: number): number {
  return ((n << 1) ^ (POLY & -(n >> 7))) & 255;
}

function mul(a: number, b: number): number {
  let res = 0;
  for (; b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul2(a);
  }
  return res;
}

function incBytes(data: Uint8Array, isLE2: boolean, carry = 1) {
  for (let i = 0; i < data.length; i++) {
    const pos = !isLE2 ? data.length - 1 - i : i;
    carry = (carry + (data[pos] & 255)) | 0;
    data[pos] = carry & 255;
    carry >>>= 8;
  }
}

const sbox = (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++, x ^= mul2(x)) t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0; i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ (x >> 4) ^ (x >> 5) ^ (x >> 6) ^ (x >> 7) ^ 99) & 255;
  }
  return box;
})();

const rotr32_8 = (n: number) => (n << 24) | (n >>> 8);
const rotl32_8 = (n: number) => (n << 8) | (n >>> 24);

function genTtable(sbox2: Uint8Array, fn: (s: number) => number) {
  const T0 = new Uint32Array(256).map((_, j) => fn(sbox2[j]));
  const T1 = T0.map(rotl32_8);
  const T2 = T1.map(rotl32_8);
  const T3 = T2.map(rotl32_8);
  const T01 = new Uint32Array(256 * 256);
  const T23 = new Uint32Array(256 * 256);
  const sbox22 = new Uint16Array(256 * 256);
  for (let i = 0; i < 256; i++) {
    for (let j = 0; j < 256; j++) {
      const idx = i * 256 + j;
      T01[idx] = T0[i] ^ T1[j];
      T23[idx] = T2[i] ^ T3[j];
      sbox22[idx] = (sbox2[i] << 8) | sbox2[j];
    }
  }
  return { sbox: sbox2, sbox2: sbox22, T01, T23 };
}

const tableEncoding = genTtable(
  sbox,
  s => (mul(s, 3) << 24) | (s << 16) | (s << 8) | mul(s, 2),
);

const xPowers = (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1; i < 16; i++, x = mul2(x)) p[i] = x;
  return p;
})();

function expandKeyLE(key: Uint8Array): Uint32Array {
  validateKeyLength(key);
  const len = key.length;
  const { sbox2 } = tableEncoding;
  const k32 = new Uint32Array(
    key.buffer,
    key.byteOffset,
    Math.floor(key.byteLength / 4),
  );
  const Nk = k32.length;
  const subByte = (n: number) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk; i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[Math.floor(i / Nk) - 1];
    else if (Nk > 6 && i % Nk === 4) t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  return xk;
}

function apply0123(
  T01: Uint32Array,
  T23: Uint32Array,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
): number {
  return (
    T01[((s0 << 8) & 65280) | ((s1 >>> 8) & 255)] ^
    T23[((s2 >>> 8) & 65280) | ((s3 >>> 24) & 255)]
  );
}

function applySbox(
  sbox2: Uint16Array,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
): number {
  return (
    sbox2[(s0 & 255) | (s1 & 65280)] |
    (sbox2[((s2 >>> 16) & 255) | ((s3 >>> 16) & 65280)] << 16)
  );
}

function encryptBlockInternal(
  xk: Uint32Array,
  s0: number,
  s1: number,
  s2: number,
  s3: number,
) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++];
  s1 ^= xk[k++];
  s2 ^= xk[k++];
  s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t02;
    s1 = t12;
    s2 = t22;
    s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}

export function aesCtrDecrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  src: Uint8Array,
): Uint8Array {
  const xk = expandKeyLE(key);
  const ctr2 = Uint8Array.from(nonce);
  const c32 = new Uint32Array(ctr2.buffer, ctr2.byteOffset, 4);
  const srcLen = src.length;
  const dst = new Uint8Array(srcLen);
  let { s0, s1, s2, s3 } = encryptBlockInternal(
    xk,
    c32[0],
    c32[1],
    c32[2],
    c32[3],
  );

  // Use DataView or byte loop to avoid alignment issues
  const src32Len = Math.floor(srcLen / 4);
  const srcView = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const dstView = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);

  for (let i = 0; i + 4 <= src32Len; i += 4) {
    dstView.setUint32(
      (i + 0) * 4,
      srcView.getUint32((i + 0) * 4, true) ^ s0,
      true,
    );
    dstView.setUint32(
      (i + 1) * 4,
      srcView.getUint32((i + 1) * 4, true) ^ s1,
      true,
    );
    dstView.setUint32(
      (i + 2) * 4,
      srcView.getUint32((i + 2) * 4, true) ^ s2,
      true,
    );
    dstView.setUint32(
      (i + 3) * 4,
      srcView.getUint32((i + 3) * 4, true) ^ s3,
      true,
    );
    incBytes(ctr2, false, 1);
    ({ s0, s1, s2, s3 } = encryptBlockInternal(
      xk,
      c32[0],
      c32[1],
      c32[2],
      c32[3],
    ));
  }

  const start = BLOCK_SIZE * Math.floor(src32Len / BLOCK_SIZE32);
  if (start < srcLen) {
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    const buf = new Uint8Array(b32.buffer);
    for (let i = start, pos = 0; i < srcLen; i++, pos++) {
      dst[i] = src[i] ^ buf[pos];
    }
  }
  return dst;
}
