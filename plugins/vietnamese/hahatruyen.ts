import { fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class HahaTruyenPlugin implements Plugin.PluginBase {
  id = 'hahatruyen';
  name = 'Haha Truyện';
  icon = 'src/vi/hahatruyen/icon.png';
  site = 'https://hahatruyen.com.vn';
  version = '1.0.2';

  fallbackSites = [
    'https://hahatruyen.com.vn',
    'https://hahatruyen.com',
    'https://hahatruyen.vn',
  ];

  private async fetchWithFallback(pathOrUrl: string): Promise<string> {
    const urlsToTry: string[] = [];
    if (pathOrUrl.startsWith('http')) {
      urlsToTry.push(pathOrUrl);
      for (const fb of this.fallbackSites) {
        if (!pathOrUrl.startsWith(fb)) {
          const path = pathOrUrl.replace(/^https?:\/\/[^/]+/, '');
          urlsToTry.push(fb + path);
        }
      }
    } else {
      urlsToTry.push(this.site + pathOrUrl);
      for (const fb of this.fallbackSites) {
        if (fb !== this.site) {
          urlsToTry.push(fb + pathOrUrl);
        }
      }
    }

    for (const u of urlsToTry) {
      try {
        const body = await fetchText(u);
        if (body && body.length > 300) {
          return body;
        }
      } catch {
        // Continue to fallback
      }
    }
    throw new Error(`Failed to fetch from ${pathOrUrl}`);
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const url =
      pageNo === 1 ? '/' : `/vi/68/truyen-ngon-tinh-sac-gioi/page-${pageNo}/`;
    const body = await this.fetchWithFallback(url);
    const $ = loadCheerio(body);

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('.divimage, .divdocok, .story-item').each((_, ele) => {
      const link = $(ele).find('h3 a, a[href*="/vi/"]').first();
      let href = link.attr('href') || $(ele).find('a').attr('href');
      if (!href) return;

      for (const s of this.fallbackSites) {
        href = href.replace(s, '');
      }
      href = href.replace(/^https?:\/\/[^/]+/, '');

      const match = href.match(/\/vi\/(\d+)\/([^/]+)/);
      if (!match || Number(match[1]) < 100) return;

      if (seen.has(href)) return;
      seen.add(href);

      let name = $(ele).find('h3, .title').text().trim();
      if (!name) {
        name = link.attr('title') || link.text().trim();
      }
      name = name.replace(/^Truyện\s+(h\+\s+)?sắc\s+/i, '').trim();

      const img = $(ele).find('img').first();
      let cover = img.attr('data-src') || img.attr('src') || defaultCover;
      if (cover.startsWith('/')) {
        cover = this.site + cover;
      }

      if (name && href) {
        novels.push({
          name,
          path: href,
          cover,
        });
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const body = await this.fetchWithFallback(novelPath);
    const $ = loadCheerio(body);

    const title =
      $('h1').first().text().trim() || $('.title').first().text().trim();
    const img = $('.thumb img, .divdocok img, img').first();
    let cover = img.attr('src') || img.attr('data-src') || defaultCover;
    if (cover.startsWith('/')) {
      cover = this.site + cover;
    }

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: title.replace(/^Truyện\s+(h\+\s+)?sắc\s+/i, '').trim(),
      cover,
    };

    novel.summary = $(
      '.desc, .description, .intro, .detail-content, .story-intro',
    )
      .first()
      .text()
      .trim();

    novel.author = $(
      '.author a, .info:contains("Tác giả") a, .meta:contains("Tác giả")',
    )
      .first()
      .text()
      .trim();

    const genres: string[] = [];
    $('.genres a, a[href*="/vi/"][href*="truyen-"]').each((_, a) => {
      const g = $(a).text().trim();
      if (g && !genres.includes(g)) genres.push(g);
    });
    novel.genres = genres.join(', ');

    novel.status = NovelStatus.Ongoing;

    // Detect highest chapter number
    let maxChapter = 0;
    const cleanNovelPath = novelPath.replace(/\/$/, '');
    $('a[href*="/truyen-full-chapter-"]').each((_, ele) => {
      const h = $(ele).attr('href') || '';
      const m = h.match(/truyen-full-chapter-(\d+)/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (num > maxChapter) maxChapter = num;
      }
    });

    const chapters: Plugin.ChapterItem[] = [];

    // If sequential chapters are detected, generate all chapters 1..maxChapter
    // Note: On HahaTruyen, Chapter 1 is the base novel page itself (${cleanNovelPath}/),
    // while Chapter 2 onwards are ${cleanNovelPath}/truyen-full-chapter-2/ up to N.
    if (maxChapter > 0) {
      chapters.push({
        name: 'Chương 1',
        path: `${cleanNovelPath}/`,
      });
      for (let i = 2; i <= maxChapter; i++) {
        chapters.push({
          name: `Chương ${i}`,
          path: `${cleanNovelPath}/truyen-full-chapter-${i}/`,
        });
      }
    } else {
      // Fallback: collect any linked chapters
      const seenChaps = new Set<string>();
      $('a[href*="/truyen-full-chapter-"]').each((_, ele) => {
        let href = $(ele).attr('href');
        let name = $(ele).text().trim();
        if (!href) return;

        for (const s of this.fallbackSites) {
          href = href.replace(s, '');
        }
        href = href.replace(/^https?:\/\/[^/]+/, '');

        if (name.toLowerCase() === 'sau' || name.toLowerCase() === 'trước')
          return;
        if (seenChaps.has(href)) return;
        seenChaps.add(href);

        chapters.push({
          name,
          path: href,
        });
      });
      chapters.reverse();
    }

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await this.fetchWithFallback(chapterPath);
    const $ = loadCheerio(body);

    $('.ads, script, style, .social-share, .fb-like').remove();
    $(
      '#tctcontent p:contains("DMCA"), #tctcontent p:contains("HaHa Truyện là nền tảng")',
    ).remove();

    const chapterText = $(
      '#tctcontent, .content.col-xs-24, #chapter-content',
    ).html();
    return chapterText || '';
  }

  async searchNovels(searchTerm: string): Promise<Plugin.NovelItem[]> {
    const url = `/vi/tim-truyen/?q=${encodeURIComponent(searchTerm)}`;
    const body = await this.fetchWithFallback(url);
    const $ = loadCheerio(body);

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('.divimage, a[href*="/vi/"]').each((_, ele) => {
      const a = $(ele).is('a') ? $(ele) : $(ele).find('a').first();
      let href = a.attr('href');
      if (!href) return;

      for (const s of this.fallbackSites) {
        href = href.replace(s, '');
      }
      href = href.replace(/^https?:\/\/[^/]+/, '');

      const match = href.match(/\/vi\/(\d+)\/([^/]+)/);
      if (!match || Number(match[1]) < 100) return;

      if (seen.has(href)) return;
      seen.add(href);

      let name = a.attr('title') || a.text().trim();
      name = name.replace(/^Truyện\s+(h\+\s+)?sắc\s+/i, '').trim();

      const img = $(ele).find('img').first();
      let cover = img.attr('data-src') || img.attr('src') || defaultCover;
      if (cover.startsWith('/')) {
        cover = this.site + cover;
      }

      if (name && href) {
        novels.push({
          name,
          path: href,
          cover,
        });
      }
    });

    return novels;
  }
}

export default new HahaTruyenPlugin();
