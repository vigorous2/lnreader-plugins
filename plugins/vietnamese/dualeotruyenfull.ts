import { fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class DuaLeoTruyenPlugin implements Plugin.PluginBase {
  id = 'dualeotruyenfull';
  name = 'Dưa Leo Truyện';
  icon = 'src/vi/dualeotruyenfull/icon.png';
  site = 'https://dualeotruyenfull.net';
  version = '1.0.0';

  fallbackSites = [
    'https://dualeotruyenfull.net',
    'https://dualeotruyen.net',
    'https://dualeotruyen.org',
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
        if (body && body.length > 500) {
          return body;
        }
      } catch {
        // Try next fallback
      }
    }
    throw new Error(`Failed to fetch from ${pathOrUrl}`);
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const url = pageNo === 1 ? '/moi-cap-nhat/' : `/moi-cap-nhat/page/${pageNo}/`;
    const body = await this.fetchWithFallback(url);
    const $ = loadCheerio(body);

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('a[href*="/doc-truyen/"]').each((_, a) => {
      let href = $(a).attr('href') || '';
      for (const s of this.fallbackSites) {
        href = href.replace(s, '');
      }
      href = href.replace(/^https?:\/\/[^/]+/, '');

      const match = href.match(/^\/doc-truyen\/([^/]+)\/?$/);
      if (!match || match[1] === 'moi-cap-nhat') return;

      if (seen.has(href)) return;

      let name = $(a).attr('title') || $(a).text().trim();
      if (!name || name === 'Truyện mới' || name === 'Đọc') {
        const parent = $(a).closest('div, article');
        name = parent.find('h2, h3, .post-title, .title').first().text().trim();
      }
      if (name.includes('#')) {
        name = name.split('#')[0].trim();
      }
      if (!name || name.length < 2) return;

      seen.add(href);

      const card = $(a).closest('div, article');
      const img = card.find('img').first();
      const cover = img.attr('data-src') || img.attr('src') || defaultCover;

      novels.push({
        name,
        path: href,
        cover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const body = await this.fetchWithFallback(novelPath);
    const $ = loadCheerio(body);

    const title = $('h1').first().text().trim();
    const cover =
      $('.story-cover img, .thumb img, .c-tabs-item__content img, img')
        .first()
        .attr('src') || defaultCover;

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: title,
      cover,
    };

    novel.summary = $(
      '.story-description, .desc, .description, .entry-content, #tab-summary, .truyen-info-summary',
    )
      .first()
      .text()
      .trim();

    novel.author = $(
      '.author a, .post-content_item:contains("Tác giả") a, .info:contains("Tác giả")',
    )
      .first()
      .text()
      .trim();

    const genres: string[] = [];
    $('.genres-content a, a[href*="/the-loai/"]').each((_, a) => {
      const g = $(a).text().trim();
      if (g && !genres.includes(g)) genres.push(g);
    });
    novel.genres = genres.join(', ');

    novel.status = NovelStatus.Ongoing;

    const chapters: Plugin.ChapterItem[] = [];
    const seen = new Set<string>();

    $('a[href*="/chuong-"], a[href*="/chapter-"]').each((_, ele) => {
      let href = $(ele).attr('href');
      let name = $(ele).text().trim();
      if (!href) return;

      for (const s of this.fallbackSites) {
        href = href.replace(s, '');
      }
      href = href.replace(/^https?:\/\/[^/]+/, '');

      if (name.includes('\n')) {
        name = name.split('\n')[0].trim();
      }

      if (seen.has(href)) return;
      seen.add(href);

      if (name && href) {
        chapters.push({
          name,
          path: href,
        });
      }
    });

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await this.fetchWithFallback(chapterPath);
    const $ = loadCheerio(body);

    $('#ads-chapter-top, #ads-chapter-bottom, .ads, script, style, .iue-content, .uk-pagination').remove();

    const chapterText = $(
      '#chapter-content, .uk-article.text-based, .chapter-body, .entry-content',
    ).html();

    return chapterText || '';
  }

  async searchNovels(searchTerm: string): Promise<Plugin.NovelItem[]> {
    const url = `/?s=${encodeURIComponent(searchTerm)}`;
    const body = await this.fetchWithFallback(url);
    const $ = loadCheerio(body);

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('a[href*="/doc-truyen/"]').each((_, ele) => {
      let href = $(ele).attr('href');
      if (!href) return;

      for (const s of this.fallbackSites) {
        href = href.replace(s, '');
      }
      href = href.replace(/^https?:\/\/[^/]+/, '');

      // Avoid comment or chapter links
      if (href.includes('#') || href.includes('/chuong-')) return;
      const match = href.match(/^\/doc-truyen\/([^/]+)\/?$/);
      if (!match) return;

      let name = $(ele).attr('title') || $(ele).text().trim();
      if (!name || name === 'Đọc') {
        const parent = $(ele).closest('div, article');
        name = parent.find('h2, h3, .post-title, .title').first().text().trim();
      }
      if (name.includes('#')) {
        name = name.split('#')[0].trim();
      }
      if (!name || name.length < 2) return;

      if (seen.has(href)) return;
      seen.add(href);

      const img = $(ele).closest('div').find('img').first();
      const cover = img.attr('data-src') || img.attr('src') || defaultCover;

      novels.push({
        name,
        path: href,
        cover,
      });
    });

    return novels;
  }
}

export default new DuaLeoTruyenPlugin();
