import { fetchApi, fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { aesCtrDecrypt } from './aesCtr';
import { unzipSync, strFromU8 } from 'fflate';
import { FilterTypes, Filters } from '@libs/filterInputs';

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
  version = '1.0.4';

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
      const parent = $(ele).closest(
        'article, .col_item, .news-community, .rh_grid_image_wrapper, .news_out_tabs, div',
      );
      const coverImg = parent.find('img').first();
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
      const parent = $(ele).closest(
        'article, .col_item, .news-community, .rh_grid_image_wrapper, .news_out_tabs, div',
      );
      const coverImg = parent.find('img').first();
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
