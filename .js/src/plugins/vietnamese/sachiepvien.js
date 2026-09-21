"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/vietnamese/sachiepvien.ts
var sachiepvien_exports = {};
__export(sachiepvien_exports, {
  default: () => sachiepvien_default
});
module.exports = __toCommonJS(sachiepvien_exports);
var import_fetch = require("@libs/fetch");
var import_cheerio = require("cheerio");
var import_defaultCover = require("@libs/defaultCover");
var import_novelStatus = require("@libs/novelStatus");

// node_modules/@noble/ciphers/utils.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function abytes(value, length, title = "") {
  const bytes = isBytes(value);
  const len = value?.length;
  const needsLen = length !== void 0;
  if (!bytes || needsLen && len !== length) {
    const prefix = title && `"${title}" `;
    const ofLen = needsLen ? ` of length ${length}` : "";
    const got = bytes ? `length=${len}` : `type=${typeof value}`;
    throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
  }
  return value;
}
function u8(arr) {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function overlapBytes(a, b) {
  return a.buffer === b.buffer && // best we can do, may fail with an obscure Proxy
  a.byteOffset < b.byteOffset + b.byteLength && // a starts before b end
  b.byteOffset < a.byteOffset + a.byteLength;
}
function complexOverlapBytes(input, output) {
  if (overlapBytes(input, output) && input.byteOffset < output.byteOffset)
    throw new Error("complex overlap of input and output is not supported");
}
var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
  function wrappedCipher(key, ...args) {
    abytes(key, void 0, "key");
    if (!isLE)
      throw new Error("Non little-endian hardware is not yet supported");
    if (params.nonceLength !== void 0) {
      const nonce = args[0];
      abytes(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
    }
    const tagl = params.tagLength;
    if (tagl && args[1] !== void 0)
      abytes(args[1], void 0, "AAD");
    const cipher = constructor(key, ...args);
    const checkOutput = (fnLength, output) => {
      if (output !== void 0) {
        if (fnLength !== 2)
          throw new Error("cipher output not supported");
        abytes(output, void 0, "output");
      }
    };
    let called = false;
    const wrCipher = {
      encrypt(data, output) {
        if (called)
          throw new Error("cannot encrypt() twice with same key + nonce");
        called = true;
        abytes(data);
        checkOutput(cipher.encrypt.length, output);
        return cipher.encrypt(data, output);
      },
      decrypt(data, output) {
        abytes(data);
        if (tagl && data.length < tagl)
          throw new Error('"ciphertext" expected length bigger than tagLength=' + tagl);
        checkOutput(cipher.decrypt.length, output);
        return cipher.decrypt(data, output);
      }
    };
    return wrCipher;
  }
  Object.assign(wrappedCipher, params);
  return wrappedCipher;
};
function getOutput(expectedLength, out, onlyAligned = true) {
  if (out === void 0)
    return new Uint8Array(expectedLength);
  if (out.length !== expectedLength)
    throw new Error('"output" expected Uint8Array of length ' + expectedLength + ", got: " + out.length);
  if (onlyAligned && !isAligned32(out))
    throw new Error("invalid output, must be aligned");
  return out;
}
function isAligned32(bytes) {
  return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
  return Uint8Array.from(bytes);
}

// node_modules/@noble/ciphers/aes.js
var BLOCK_SIZE = 16;
var BLOCK_SIZE32 = 4;
var POLY = 283;
function validateKeyLength(key) {
  if (![16, 24, 32].includes(key.length))
    throw new Error('"aes key" expected Uint8Array of length 16/24/32, got length=' + key.length);
}
function mul2(n) {
  return n << 1 ^ POLY & -(n >> 7);
}
function mul(a, b) {
  let res = 0;
  for (; b > 0; b >>= 1) {
    res ^= a & -(b & 1);
    a = mul2(a);
  }
  return res;
}
var incBytes = (data, isLE2, carry = 1) => {
  if (!Number.isSafeInteger(carry))
    throw new Error("incBytes: wrong carry " + carry);
  abytes(data);
  for (let i = 0; i < data.length; i++) {
    const pos = !isLE2 ? data.length - 1 - i : i;
    carry = carry + (data[pos] & 255) | 0;
    data[pos] = carry & 255;
    carry >>>= 8;
  }
};
var sbox = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0, x = 1; i < 256; i++, x ^= mul2(x))
    t[i] = x;
  const box = new Uint8Array(256);
  box[0] = 99;
  for (let i = 0; i < 255; i++) {
    let x = t[255 - i];
    x |= x << 8;
    box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
  }
  clean(t);
  return box;
})();
var rotr32_8 = (n) => n << 24 | n >>> 8;
var rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox2, fn) {
  if (sbox2.length !== 256)
    throw new Error("Wrong sbox length");
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
      sbox22[idx] = sbox2[i] << 8 | sbox2[j];
    }
  }
  return { sbox: sbox2, sbox2: sbox22, T0, T1, T2, T3, T01, T23 };
}
var tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
var xPowers = /* @__PURE__ */ (() => {
  const p = new Uint8Array(16);
  for (let i = 0, x = 1; i < 16; i++, x = mul2(x))
    p[i] = x;
  return p;
})();
function expandKeyLE(key) {
  abytes(key);
  const len = key.length;
  validateKeyLength(key);
  const { sbox2 } = tableEncoding;
  const toClean = [];
  if (!isAligned32(key))
    toClean.push(key = copyBytes(key));
  const k32 = u32(key);
  const Nk = k32.length;
  const subByte = (n) => applySbox(sbox2, n, n, n, n);
  const xk = new Uint32Array(len + 28);
  xk.set(k32);
  for (let i = Nk; i < xk.length; i++) {
    let t = xk[i - 1];
    if (i % Nk === 0)
      t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
    else if (Nk > 6 && i % Nk === 4)
      t = subByte(t);
    xk[i] = xk[i - Nk] ^ t;
  }
  clean(...toClean);
  return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
  return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
  return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt(xk, s0, s1, s2, s3) {
  const { sbox2, T01, T23 } = tableEncoding;
  let k = 0;
  s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
  const rounds = xk.length / 4 - 2;
  for (let i = 0; i < rounds; i++) {
    const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
    const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
    const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
    const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
    s0 = t02, s1 = t12, s2 = t22, s3 = t32;
  }
  const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
  const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
  const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
  const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
  return { s0: t0, s1: t1, s2: t2, s3: t3 };
}
function ctrCounter(xk, nonce, src, dst) {
  abytes(nonce, BLOCK_SIZE, "nonce");
  abytes(src);
  const srcLen = src.length;
  dst = getOutput(srcLen, dst);
  complexOverlapBytes(src, dst);
  const ctr2 = nonce;
  const c32 = u32(ctr2);
  let { s0, s1, s2, s3 } = encrypt(xk, c32[0], c32[1], c32[2], c32[3]);
  const src32 = u32(src);
  const dst32 = u32(dst);
  for (let i = 0; i + 4 <= src32.length; i += 4) {
    dst32[i + 0] = src32[i + 0] ^ s0;
    dst32[i + 1] = src32[i + 1] ^ s1;
    dst32[i + 2] = src32[i + 2] ^ s2;
    dst32[i + 3] = src32[i + 3] ^ s3;
    incBytes(ctr2, false, 1);
    ({ s0, s1, s2, s3 } = encrypt(xk, c32[0], c32[1], c32[2], c32[3]));
  }
  const start = BLOCK_SIZE * Math.floor(src32.length / BLOCK_SIZE32);
  if (start < srcLen) {
    const b32 = new Uint32Array([s0, s1, s2, s3]);
    const buf = u8(b32);
    for (let i = start, pos = 0; i < srcLen; i++, pos++)
      dst[i] = src[i] ^ buf[pos];
    clean(b32);
  }
  return dst;
}
var ctr = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 16 }, function aesctr(key, nonce) {
  function processCtr(buf, dst) {
    abytes(buf);
    if (dst !== void 0) {
      abytes(dst);
      if (!isAligned32(dst))
        throw new Error("unaligned destination");
    }
    const xk = expandKeyLE(key);
    const n = copyBytes(nonce);
    const toClean = [xk, n];
    if (!isAligned32(buf))
      toClean.push(buf = copyBytes(buf));
    const out = ctrCounter(xk, n, buf, dst);
    clean(...toClean);
    return out;
  }
  return {
    encrypt: (plaintext, dst) => processCtr(plaintext, dst),
    decrypt: (ciphertext, dst) => processCtr(ciphertext, dst)
  };
});
function isBytes32(a) {
  return a instanceof Uint32Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint32Array";
}
function encryptBlock(xk, block) {
  abytes(block, 16, "block");
  if (!isBytes32(xk))
    throw new Error("_encryptBlock accepts result of expandKeyLE");
  const b32 = u32(block);
  let { s0, s1, s2, s3 } = encrypt(xk, b32[0], b32[1], b32[2], b32[3]);
  b32[0] = s0, b32[1] = s1, b32[2] = s2, b32[3] = s3;
  return block;
}
function dbl(block) {
  let carry = 0;
  for (let i = BLOCK_SIZE - 1; i >= 0; i--) {
    const newCarry = (block[i] & 128) >>> 7;
    block[i] = block[i] << 1 | carry;
    carry = newCarry;
  }
  if (carry) {
    block[BLOCK_SIZE - 1] ^= 135;
  }
  return block;
}
function xorBlock(a, b) {
  if (a.length !== b.length)
    throw new Error("xorBlock: blocks must have same length");
  for (let i = 0; i < a.length; i++) {
    a[i] = a[i] ^ b[i];
  }
  return a;
}
var _CMAC = class {
  buffer;
  destroyed;
  k1;
  k2;
  xk;
  constructor(key) {
    abytes(key);
    validateKeyLength(key);
    this.xk = expandKeyLE(key);
    this.buffer = new Uint8Array(0);
    this.destroyed = false;
    const L = new Uint8Array(BLOCK_SIZE);
    encryptBlock(this.xk, L);
    this.k1 = dbl(L);
    this.k2 = dbl(new Uint8Array(this.k1));
  }
  update(data) {
    const { destroyed, buffer } = this;
    if (destroyed)
      throw new Error("CMAC instance was destroyed");
    abytes(data);
    const newBuffer = new Uint8Array(buffer.length + data.length);
    newBuffer.set(buffer);
    newBuffer.set(data, buffer.length);
    this.buffer = newBuffer;
    return this;
  }
  // see https://www.rfc-editor.org/rfc/rfc4493.html#section-2.4
  digest() {
    if (this.destroyed)
      throw new Error("CMAC instance was destroyed");
    const { buffer } = this;
    const msgLen = buffer.length;
    let n = Math.ceil(msgLen / BLOCK_SIZE);
    let flag;
    if (n === 0) {
      n = 1;
      flag = false;
    } else {
      flag = msgLen % BLOCK_SIZE === 0;
    }
    const lastBlockStart = (n - 1) * BLOCK_SIZE;
    const lastBlockData = buffer.subarray(lastBlockStart);
    let m_last;
    if (flag) {
      m_last = xorBlock(new Uint8Array(lastBlockData), this.k1);
    } else {
      const padded = new Uint8Array(BLOCK_SIZE);
      padded.set(lastBlockData);
      padded[lastBlockData.length] = 128;
      m_last = xorBlock(padded, this.k2);
    }
    let x = new Uint8Array(BLOCK_SIZE);
    for (let i = 0; i < n - 1; i++) {
      const m_i = buffer.subarray(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE);
      xorBlock(x, m_i);
      encryptBlock(this.xk, x);
    }
    xorBlock(x, m_last);
    encryptBlock(this.xk, x);
    clean(m_last);
    return x;
  }
  destroy() {
    const { buffer, destroyed, xk, k1, k2 } = this;
    if (destroyed)
      return;
    this.destroyed = true;
    clean(buffer, xk, k1, k2);
  }
};
var cmac = (key, message) => new _CMAC(key).update(message).digest();
cmac.create = (key) => new _CMAC(key);

// plugins/vietnamese/sachiepvien.ts
var import_filterInputs = require("@libs/filterInputs");
var novelChaptersCache = /* @__PURE__ */ new Map();
function b64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) {
    str += "=";
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
function deriveKeyAndIv(keyBytes) {
  const view = new DataView(
    keyBytes.buffer,
    keyBytes.byteOffset,
    keyBytes.byteLength
  );
  const k = [];
  for (let i = 0; i < 8; i++) {
    k.push(view.getUint32(i * 4, false));
  }
  const aesKeyBytes = new Uint8Array(16);
  const aesView = new DataView(aesKeyBytes.buffer);
  for (let i = 0; i < 4; i++) {
    aesView.setUint32(i * 4, k[i] ^ k[i + 4], false);
  }
  const ivBytes = new Uint8Array(16);
  const ivView = new DataView(ivBytes.buffer);
  ivView.setUint32(0, k[4], false);
  ivView.setUint32(4, k[5], false);
  ivView.setUint32(8, 0, false);
  ivView.setUint32(12, 0, false);
  return { aesKeyBytes, ivBytes };
}
async function downloadAndDecryptMega(fileId, keyStr) {
  const apiRes = await (0, import_fetch.fetchApi)("https://g.api.mega.co.nz/cs?id=0", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ a: "g", g: 1, p: fileId }])
  });
  const apiData = await apiRes.json();
  const fileInfo = apiData?.[0];
  if (!fileInfo || !fileInfo.g) {
    throw new Error("Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c link t\u1EA3i t\u1EEB MEGA");
  }
  const keyBytes = b64UrlDecode(keyStr);
  const { aesKeyBytes, ivBytes } = deriveKeyAndIv(keyBytes);
  const dlUrl = fileInfo.g.replace(/^http:\/\//i, "https://");
  const dlRes = await (0, import_fetch.fetchApi)(dlUrl);
  if (!dlRes.ok) {
    throw new Error(`T\u1EA3i file th\u1EA5t b\u1EA1i: HTTP ${dlRes.status}`);
  }
  const encArrayBuffer = await dlRes.arrayBuffer();
  const encBytes = new Uint8Array(encArrayBuffer);
  const headerCheck = new TextDecoder("utf-8").decode(encBytes.slice(0, 100));
  if (headerCheck.includes("<!DOCTYPE") || headerCheck.includes("<html")) {
    throw new Error(
      "T\u1EA3i file th\u1EA5t b\u1EA1i (nh\u1EADn ph\u1EA3n h\u1ED3i web thay v\xEC file d\u1EEF li\u1EC7u truy\u1EC7n)"
    );
  }
  const cipher = ctr(aesKeyBytes, ivBytes);
  const decBytes = cipher.decrypt(encBytes);
  const text = new TextDecoder("utf-8").decode(decBytes);
  return text;
}
function formatChapterName(rawName, index) {
  const txtMatch = rawName.match(/(\d+)(?:\s*\(\d+\))?\.txt/i);
  if (txtMatch) {
    return `Ch\u01B0\u01A1ng ${txtMatch[1]}`;
  }
  return rawName.replace(/^[-=~_*#\s]+|[-=~_*#\s]+$/g, "").trim() || `Ch\u01B0\u01A1ng ${index + 1}`;
}
function splitTextToChapters(fullText) {
  const lines = fullText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const chapRegex = /^(?:chương|hồi|tiết|quyển|phần|thứ)\s*[\d一二三四五六七八九十百千]+|chapter\s*\d+|[-=~_*]{2,}\s*.*?(?:\d+|chương|chap).*?[-=~_*]{2,}/i;
  const chapters = [];
  let current = null;
  for (const line of lines) {
    if (chapRegex.test(line) && line.length < 90) {
      if (current && current.lines.length > 0) {
        chapters.push(current);
      }
      const formattedName = formatChapterName(line, chapters.length);
      current = { name: formattedName, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      if (!current) {
        current = { name: "M\u1EDF \u0111\u1EA7u / Gi\u1EDBi thi\u1EC7u", lines: [line] };
      }
    }
  }
  if (current && current.lines.length > 0) {
    chapters.push(current);
  }
  if (chapters.length <= 1 && lines.length > 150) {
    const chunked = [];
    const chunkSize = 200;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const partNum = Math.floor(i / chunkSize) + 1;
      chunked.push({
        name: `Ph\u1EA7n ${partNum}`,
        lines: lines.slice(i, i + chunkSize)
      });
    }
    return chunked;
  }
  return chapters;
}
var SachHiepVienPlugin = class {
  constructor() {
    this.id = "sachiepvien";
    this.name = "S\u1EAFc Hi\u1EC7p Vi\u1EC7n";
    this.icon = "src/vi/sachiepvien/icon.png";
    this.site = "https://sachiepvien.net";
    this.version = "1.0.2";
    this.filters = {
      category: {
        type: import_filterInputs.FilterTypes.Picker,
        label: "Chuy\xEAn m\u1EE5c",
        value: "kho-truyen",
        options: [
          {
            label: "Kho Truy\u1EC7n (M\u1EDBi nh\u1EA5t - H\xE0ng ng\xE0n truy\u1EC7n)",
            value: "kho-truyen"
          },
          { label: "\u0110\u1EC1 C\u1EED Tuy\u1EC3n Ch\u1ECDn", value: "de-cu" },
          { label: "S\xE1ng T\xE1c", value: "sang-tac" },
          { label: "D\u1ECBch \u2013 Edit", value: "dich-edit" }
        ]
      }
    };
  }
  async popularNovels(pageNo, options) {
    const cat = options?.filters?.category?.value || "kho-truyen";
    let url = "";
    if (cat === "kho-truyen") {
      url = pageNo === 1 ? `${this.site}/kho-truyen-v2/` : `${this.site}/kho-truyen-v2/page/${pageNo}/`;
    } else {
      url = pageNo === 1 ? `${this.site}/category/${cat}/` : `${this.site}/category/${cat}/page/${pageNo}/`;
    }
    const body = await (0, import_fetch.fetchText)(url);
    const $ = (0, import_cheerio.load)(body);
    const novels = [];
    $("h2 a").each((_, ele) => {
      const href = $(ele).attr("href");
      const name = $(ele).text().trim();
      const parent = $(ele).closest(
        "article, .col_item, .news-community, .rh_grid_image_wrapper, .news_out_tabs, div"
      );
      const coverImg = parent.find("img").first();
      const cover = coverImg.attr("data-src") || coverImg.attr("src") || import_defaultCover.defaultCover;
      if (href && name && href.includes("sachiepvien.net")) {
        if (!href.includes("/category/") && !href.includes("/tac_gia/") && !href.includes("/kho-truyen-v2") && !href.includes("/blog") && !href.includes("/bang-xep-hang") && !href.includes("/group-social")) {
          const rawPath = href.replace(this.site, "");
          const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
          novels.push({
            name,
            path,
            cover
          });
        }
      }
    });
    return novels;
  }
  async parseNovel(novelPath) {
    const normalizedPath = novelPath.startsWith("/") ? novelPath : `/${novelPath}`;
    const url = this.site + normalizedPath;
    const body = await (0, import_fetch.fetchText)(url);
    const $ = (0, import_cheerio.load)(body);
    const title = $("h1").first().text().trim() || "Kh\xF4ng c\xF3 ti\xEAu \u0111\u1EC1";
    const coverImg = $(
      ".post-thumb img, article img, .entry-content img"
    ).first();
    const cover = coverImg.attr("data-src") || coverImg.attr("src") || import_defaultCover.defaultCover;
    const summary = $(".entry-content p").slice(0, 3).map((_, el) => $(el).text().trim()).get().join("\n\n");
    const candidates = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      if (!href) return;
      let resolved = null;
      if (href.includes("redirect.html?url=") || href.includes("redirect.html")) {
        try {
          const u = new URL(href, this.site);
          const raw = u.searchParams.get("url");
          if (raw) {
            const dec = atob(raw);
            if (dec.startsWith("http")) {
              resolved = dec;
            }
          }
        } catch {
        }
      } else if (href.includes("mega.nz/file/") || href.includes("link.sachiepvien.net/")) {
        resolved = href;
      }
      if (resolved) {
        let score = 0;
        const lower = text.toLowerCase();
        if (lower.includes("text") || lower.includes("txt")) score += 100;
        if (lower.includes("b\u1EA3n d\u1ECBch") || lower.includes("t\u1EA3i file truy\u1EC7n") || lower.includes("t\u1EA3i truy\u1EC7n"))
          score += 50;
        if (lower.includes("\u1EDF \u0111\xE2y") || lower.includes("v\u1EC1 m\xE1y")) score += 30;
        if (lower.includes("h\xECnh \u1EA3nh") || lower.includes("minh h\u1ECDa") || lower.includes("\u1EA3nh"))
          score -= 100;
        candidates.push({ text, url: resolved, score });
      }
    });
    candidates.sort((a, b) => b.score - a.score);
    let megaUrl = candidates.length > 0 ? candidates[0].url : null;
    const chapterItems = [];
    if (megaUrl) {
      if (!megaUrl.includes("mega.nz")) {
        try {
          const headRes = await (0, import_fetch.fetchApi)(megaUrl, {
            redirect: "manual",
            headers: { "x-manual-redirect": "true" }
          });
          const loc = headRes.headers.get("x-redirect-location") || headRes.headers.get("location") || await headRes.text().catch(() => "");
          if (loc && loc.includes("mega.nz")) {
            megaUrl = loc.trim();
          }
        } catch {
        }
      }
      const match = megaUrl.match(/mega\.nz\/file\/([^#]+)#(.+)/);
      if (match) {
        const fileId = match[1];
        const keyStr = match[2];
        try {
          const fullText = await downloadAndDecryptMega(fileId, keyStr);
          const chapters = splitTextToChapters(fullText);
          novelChaptersCache.set(normalizedPath, chapters);
          chapters.forEach((chap, idx) => {
            chapterItems.push({
              name: chap.name,
              path: `${normalizedPath}#chap_${idx}`
            });
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Kh\xF4ng r\xF5";
          chapterItems.push({
            name: `L\u1ED7i t\u1EA3i truy\u1EC7n: ${msg}`,
            path: `${normalizedPath}#error`
          });
        }
      }
    }
    return {
      name: title,
      path: normalizedPath,
      cover,
      status: import_novelStatus.NovelStatus.Completed,
      summary,
      chapters: chapterItems
    };
  }
  async parseChapter(chapterPath) {
    const [novelPath, hash] = chapterPath.split("#");
    const normalizedPath = novelPath.startsWith("/") ? novelPath : `/${novelPath}`;
    let chapters = novelChaptersCache.get(normalizedPath);
    if (!chapters || chapters.length === 0) {
      await this.parseNovel(normalizedPath);
      chapters = novelChaptersCache.get(normalizedPath);
    }
    if (hash && hash.startsWith("chap_")) {
      const idx = parseInt(hash.replace("chap_", ""), 10);
      const chap = chapters?.[idx];
      if (chap) {
        const paragraphs = chap.lines.map((l) => `<p>${l}</p>`).join("\n");
        return `<h2>${chap.name}</h2>
${paragraphs}`;
      }
    }
    return "<p>Kh\xF4ng t\xECm th\u1EA5y n\u1ED9i dung ch\u01B0\u01A1ng.</p>";
  }
  async searchNovels(searchTerm, pageNo) {
    const cleaned = searchTerm.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "").trim();
    const query = cleaned.split(/\s+/).slice(0, 3).join(" ") || searchTerm;
    const searchUrl = `${this.site}/page/${pageNo}/?s=${encodeURIComponent(
      query
    )}`;
    const body = await (0, import_fetch.fetchText)(searchUrl);
    const $ = (0, import_cheerio.load)(body);
    const novels = [];
    $("h2 a").each((_, ele) => {
      const href = $(ele).attr("href");
      const name = $(ele).text().trim();
      const parent = $(ele).closest(
        "article, .col_item, .news-community, .rh_grid_image_wrapper, .news_out_tabs, div"
      );
      const coverImg = parent.find("img").first();
      const cover = coverImg.attr("data-src") || coverImg.attr("src") || import_defaultCover.defaultCover;
      if (href && name && href.includes("sachiepvien.net")) {
        const rawPath = href.replace(this.site, "");
        const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
        novels.push({
          name,
          path,
          cover
        });
      }
    });
    return novels;
  }
  resolveUrl(path) {
    return this.site + path;
  }
};
var sachiepvien_default = new SachHiepVienPlugin();
/*! Bundled license information:

@noble/ciphers/utils.js:
  (*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) *)
*/

exports.default = module.exports.default || module.exports;
