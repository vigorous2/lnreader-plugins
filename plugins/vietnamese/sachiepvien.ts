import { fetchApi, fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { unzipSync, strFromU8 } from 'fflate';
import { FilterTypes, Filters } from '@libs/filterInputs';

// --- Inlined AES-CTR implementation for MEGA download ---
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

function aesCtrDecrypt(
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

type ChapterData = {
  name: string;
  lines?: string[];
  htmlContent?: string;
};

// In-memory cache for parsed novels to prevent repeated re-downloading
const novelChaptersCache = new Map<string, ChapterData[]>();

function b64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function deriveKeyAndIv(keyBytes: Uint8Array): {
  aesKeyBytes: Uint8Array;
  ivBytes: Uint8Array;
} {
  const view = new DataView(
    keyBytes.buffer,
    keyBytes.byteOffset,
    keyBytes.byteLength,
  );
  const k: number[] = [];
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

async function downloadAndDecryptMega(
  fileId: string,
  keyStr: string,
): Promise<Uint8Array> {
  // 1. Query MEGA API for stream URL
  const apiRes = await fetchApi('https://g.api.mega.co.nz/cs?id=0', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ a: 'g', g: 1, p: fileId }]),
  });
  const apiData = await apiRes.json();
  const fileInfo = apiData?.[0];
  if (!fileInfo || !fileInfo.g) {
    throw new Error('Không lấy được link tải từ MEGA');
  }

  // 2. Derive AES key and IV
  const keyBytes = b64UrlDecode(keyStr);
  const { aesKeyBytes, ivBytes } = deriveKeyAndIv(keyBytes);

  // 3. Download encrypted bytes
  const dlUrl = fileInfo.g.replace(/^http:\/\//i, 'https://');
  const dlRes = await fetchApi(dlUrl);
  if (!dlRes.ok) {
    throw new Error(`Tải file thất bại: HTTP ${dlRes.status}`);
  }
  const encArrayBuffer = await dlRes.arrayBuffer();
  const encBytes = new Uint8Array(encArrayBuffer);

  // Validate that we received raw file data, not an HTML error/fallback page
  const headerCheck = new TextDecoder('utf-8').decode(encBytes.slice(0, 100));
  if (headerCheck.includes('<!DOCTYPE') || headerCheck.includes('<html')) {
    throw new Error(
      'Tải file thất bại (nhận phản hồi web thay vì file dữ liệu truyện)',
    );
  }

  // 4. Decrypt via inlined AES-CTR
  const decBytes = aesCtrDecrypt(aesKeyBytes, ivBytes, encBytes);
  return decBytes;
}

function parseEpubBytes(bytes: Uint8Array): ChapterData[] {
  const unzipped = unzipSync(bytes);
  let opfPath = 'content.opf';

  // Find container.xml (case-insensitive search)
  for (const filename of Object.keys(unzipped)) {
    if (filename.toLowerCase() === 'meta-inf/container.xml') {
      const containerXml = strFromU8(unzipped[filename]);
      const $c = loadCheerio(containerXml, { xmlMode: true });
      const fullPath = $c('rootfile').attr('full-path');
      if (fullPath) opfPath = fullPath;
      break;
    }
  }

  // Find the OPF file in unzipped archive
  let opfData: Uint8Array | undefined = unzipped[opfPath];
  if (!opfData) {
    // Try matching case-insensitively or ending with .opf
    for (const key of Object.keys(unzipped)) {
      if (
        key.toLowerCase() === opfPath.toLowerCase() ||
        key.toLowerCase().endsWith('.opf')
      ) {
        opfPath = key;
        opfData = unzipped[key];
        break;
      }
    }
  }

  if (!opfData) {
    throw new Error('Không tìm thấy tệp content.opf trong file EPUB');
  }

  const opfDir = opfPath.includes('/')
    ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
    : '';
  const opfXml = strFromU8(opfData);
  const $opf = loadCheerio(opfXml, { xmlMode: true });

  const manifestMap = new Map<string, string>();
  $opf('manifest item').each((_, item) => {
    const id = $opf(item).attr('id');
    const href = $opf(item).attr('href');
    if (id && href) manifestMap.set(id, href);
  });

  const chapters: ChapterData[] = [];
  const itemrefs = $opf('spine itemref');

  for (let i = 0; i < itemrefs.length; i++) {
    const idref = $opf(itemrefs[i]).attr('idref');
    if (!idref) continue;
    const href = manifestMap.get(idref);
    if (!href) continue;

    const decodedHref = decodeURIComponent(href);
    const fullPath = opfDir + decodedHref;
    const fileBytes =
      unzipped[fullPath] || unzipped[opfDir + href] || unzipped[href];
    if (fileBytes) {
      const content = strFromU8(fileBytes);
      const $ch = loadCheerio(content);

      if (
        decodedHref.toLowerCase().includes('nav') ||
        decodedHref.toLowerCase().includes('toc')
      ) {
        if ($ch('nav').length > 0 && $ch('p').length < 3) {
          continue;
        }
      }

      let title = $ch('h1, h2, h3, title').first().text().trim();
      title = title.replace(/^[-=~_*#\s]+|[-=~_*#\s]+$/g, '').trim();
      if (!title || title.length > 80) {
        title = `Chương ${chapters.length + 1}`;
      }

      $ch('script, style, link').remove();
      const bodyContent = $ch('body').html() || content;
      chapters.push({
        name: title,
        htmlContent: bodyContent,
      });
    }
  }

  return chapters;
}

function formatChapterName(rawName: string, index: number): string {
  const txtMatch = rawName.match(/(\d+)(?:\s*\(\d+\))?\.txt/i);
  if (txtMatch) {
    return `Chương ${txtMatch[1]}`;
  }
  return (
    rawName.replace(/^[-=~_*#\s]+|[-=~_*#\s]+$/g, '').trim() ||
    `Chương ${index + 1}`
  );
}

function splitTextToChapters(fullText: string): ChapterData[] {
  const lines = fullText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const chapRegex =
    /^(?:chương|hồi|tiết|quyển|phần|thứ)\s*[\d一二三四五六七八九十百千]+|chapter\s*\d+|[-=~_*]{2,}\s*.*?(?:\d+|chương|chap).*?[-=~_*]{2,}/i;

  const chapters: ChapterData[] = [];
  let current: ChapterData | null = null;

  for (const line of lines) {
    if (chapRegex.test(line) && line.length < 90) {
      if (current && current.lines && current.lines.length > 0) {
        chapters.push(current);
      }
      const formattedName = formatChapterName(line, chapters.length);
      current = { name: formattedName, lines: [] };
    } else if (current && current.lines) {
      current.lines.push(line);
    } else {
      // Preface or introduction lines before chapter 1
      if (!current) {
        current = { name: 'Mở đầu / Giới thiệu', lines: [line] };
      }
    }
  }

  if (current && current.lines && current.lines.length > 0) {
    chapters.push(current);
  }

  // Fallback: If no chapters found by regex (or only 1 giant chapter), chunk every 200 paragraphs
  if (chapters.length <= 1 && lines.length > 150) {
    const chunked: ChapterData[] = [];
    const chunkSize = 200;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const partNum = Math.floor(i / chunkSize) + 1;
      chunked.push({
        name: `Phần ${partNum}`,
        lines: lines.slice(i, i + chunkSize),
      });
    }
    return chunked;
  }

  return chapters;
}

class SachHiepVienPlugin implements Plugin.PluginBase {
  id = 'sachiepvien';
  name = 'Sắc Hiệp Viện';
  icon = 'src/vi/sachiepvien/icon.png';
  site = 'https://sachiepvien.net';
  version = '1.0.10';

  filters = {
    category: {
      type: FilterTypes.Picker,
      label: 'Chuyên mục',
      value: 'kho-truyen',
      options: [
        {
          label: 'Kho Truyện (Mới nhất - Hàng ngàn truyện)',
          value: 'kho-truyen',
        },
        { label: 'Đề Cử Tuyển Chọn', value: 'de-cu' },
        { label: 'Sáng Tác', value: 'sang-tac' },
        { label: 'Dịch – Edit', value: 'dich-edit' },
      ],
    },
  } satisfies Filters;

  async popularNovels(
    pageNo: number,
    options?: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const cat = options?.filters?.category?.value || 'kho-truyen';
    let url = '';
    if (cat === 'kho-truyen') {
      url =
        pageNo === 1
          ? `${this.site}/kho-truyen-v2/`
          : `${this.site}/kho-truyen-v2/page/${pageNo}/`;
    } else {
      url =
        pageNo === 1
          ? `${this.site}/category/${cat}/`
          : `${this.site}/category/${cat}/page/${pageNo}/`;
    }

    const body = await fetchText(url);
    const $ = loadCheerio(body);

    const novels: Plugin.NovelItem[] = [];
    $('h2 a').each((_, ele) => {
      const href = $(ele).attr('href');
      const name = $(ele).text().trim();
      const card = $(ele).closest(
        '.rh_grid_image_wrapper, article, .col_item, .news-community, .news_out_tabs, .newsdetail',
      );
      const coverImg = card.find('.newsimage img, figure img, img').first();
      const cover =
        coverImg.attr('data-src') || coverImg.attr('src') || defaultCover;

      if (href && name && href.includes('sachiepvien.net')) {
        if (
          !href.includes('/category/') &&
          !href.includes('/tac_gia/') &&
          !href.includes('/kho-truyen-v2') &&
          !href.includes('/blog') &&
          !href.includes('/bang-xep-hang') &&
          !href.includes('/group-social')
        ) {
          const rawPath = href.replace(this.site, '');
          const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
          novels.push({
            name,
            path,
            cover,
          });
        }
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const normalizedPath = novelPath.startsWith('/')
      ? novelPath
      : `/${novelPath}`;
    const url = this.site + normalizedPath;
    const body = await fetchText(url);
    const $ = loadCheerio(body);

    const title = $('h1').first().text().trim() || 'Không có tiêu đề';
    const coverImg = $(
      '.post-thumb img, article img, .entry-content img',
    ).first();
    const cover =
      coverImg.attr('data-src') || coverImg.attr('src') || defaultCover;
    const summary = $('.entry-content p')
      .slice(0, 3)
      .map((_, el) => $(el).text().trim())
      .get()
      .join('\n\n');

    // Collect all candidate download links and prioritize epub/txt over images
    const candidates: { text: string; url: string; score: number }[] = [];

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href) return;

      let resolved: string | null = null;
      if (
        href.includes('redirect.html?url=') ||
        href.includes('redirect.html')
      ) {
        try {
          const u = new URL(href, this.site);
          const raw = u.searchParams.get('url');
          if (raw) {
            const dec = atob(raw);
            if (dec.startsWith('http')) {
              resolved = dec;
            }
          }
        } catch {
          // ignore
        }
      } else if (
        href.includes('mega.nz/file/') ||
        href.includes('link.sachiepvien.net/')
      ) {
        resolved = href;
      }

      if (resolved) {
        let score = 0;
        const lower = text.toLowerCase();
        if (lower.includes('epub')) score += 120;
        if (lower.includes('text') || lower.includes('txt')) score += 100;
        if (
          lower.includes('bản dịch') ||
          lower.includes('tải file truyện') ||
          lower.includes('tải truyện')
        )
          score += 50;
        if (lower.includes('ở đây') || lower.includes('về máy')) score += 30;
        if (
          lower.includes('hình ảnh') ||
          lower.includes('minh họa') ||
          lower.includes('ảnh')
        )
          score -= 100;
        candidates.push({ text, url: resolved, score });
      }
    });

    candidates.sort((a, b) => b.score - a.score);
    let megaUrl = candidates.length > 0 ? candidates[0].url : null;

    const chapterItems: Plugin.ChapterItem[] = [];

    if (megaUrl) {
      // If megaUrl is a shortlink (e.g. link.sachiepvien.net/xxxx), resolve the redirect
      if (!megaUrl.includes('mega.nz')) {
        try {
          const headRes = await fetchApi(megaUrl, {
            redirect: 'manual',
            headers: { 'x-manual-redirect': 'true' },
          });
          const loc =
            headRes.headers.get('x-redirect-location') ||
            headRes.headers.get('location') ||
            (await headRes.text().catch(() => ''));
          if (loc && loc.includes('mega.nz')) {
            megaUrl = loc.trim();
          }
        } catch {
          // ignore
        }
      }

      // Extract MEGA fileId and keyStr
      const match = megaUrl.match(/mega\.nz\/file\/([^#]+)#(.+)/);
      if (match) {
        const fileId = match[1];
        const keyStr = match[2];

        try {
          // Download and decrypt file bytes
          const decryptedBytes = await downloadAndDecryptMega(fileId, keyStr);

          // Check if file is ZIP / EPUB (Magic bytes: PK\x03\x04 = 0x50, 0x4B, 0x03, 0x04)
          const isZip =
            decryptedBytes.length > 4 &&
            decryptedBytes[0] === 0x50 &&
            decryptedBytes[1] === 0x4b &&
            decryptedBytes[2] === 0x03 &&
            decryptedBytes[3] === 0x04;

          let chapters: ChapterData[];
          if (isZip) {
            chapters = await parseEpubBytes(decryptedBytes);
          } else {
            const fullText = new TextDecoder('utf-8').decode(decryptedBytes);
            chapters = splitTextToChapters(fullText);
          }

          // Cache chapters in memory with normalized path
          novelChaptersCache.set(normalizedPath, chapters);

          // Populate chapter items
          chapters.forEach((chap, idx) => {
            chapterItems.push({
              name: chap.name,
              path: `${normalizedPath}#chap_${idx}`,
            });
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Không rõ';
          chapterItems.push({
            name: `Lỗi tải truyện: ${msg}`,
            path: `${normalizedPath}#error`,
          });
        }
      }
    }

    return {
      name: title,
      path: normalizedPath,
      cover,
      status: NovelStatus.Completed,
      summary,
      chapters: chapterItems,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const [novelPath, hash] = chapterPath.split('#');
    const normalizedPath = novelPath.startsWith('/')
      ? novelPath
      : `/${novelPath}`;

    let chapters = novelChaptersCache.get(normalizedPath);
    if (!chapters || chapters.length === 0) {
      // If cache expired, re-parse the novel to download and decrypt
      await this.parseNovel(normalizedPath);
      chapters = novelChaptersCache.get(normalizedPath);
    }

    if (hash && hash.startsWith('chap_')) {
      const idx = parseInt(hash.replace('chap_', ''), 10);
      const chap = chapters?.[idx];
      if (chap) {
        if (chap.htmlContent) {
          return `<h2>${chap.name}</h2>\n${chap.htmlContent}`;
        }
        if (chap.lines) {
          const paragraphs = chap.lines.map(l => `<p>${l}</p>`).join('\n');
          return `<h2>${chap.name}</h2>\n${paragraphs}`;
        }
      }
    }

    return '<p>Không tìm thấy nội dung chương.</p>';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const cleaned = searchTerm
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .trim();
    const query = cleaned.split(/\s+/).slice(0, 3).join(' ') || searchTerm;

    const searchUrl = `${this.site}/page/${pageNo}/?s=${encodeURIComponent(
      query,
    )}`;
    const body = await fetchText(searchUrl);
    const $ = loadCheerio(body);

    const novels: Plugin.NovelItem[] = [];
    $('h2 a').each((_, ele) => {
      const href = $(ele).attr('href');
      const name = $(ele).text().trim();
      const card = $(ele).closest(
        '.rh_grid_image_wrapper, article, .col_item, .news-community, .news_out_tabs, .newsdetail',
      );
      const coverImg = card.find('.newsimage img, figure img, img').first();
      const cover =
        coverImg.attr('data-src') || coverImg.attr('src') || defaultCover;

      if (href && name && href.includes('sachiepvien.net')) {
        const rawPath = href.replace(this.site, '');
        const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
        novels.push({
          name,
          path,
          cover,
        });
      }
    });

    return novels;
  }

  resolveUrl(path: string): string {
    return this.site + path;
  }
}

export default new SachHiepVienPlugin();
