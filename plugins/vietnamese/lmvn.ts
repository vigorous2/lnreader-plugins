import { fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class LMVNPlugin implements Plugin.PluginBase {
  id = 'lmvn';
  name = 'LMVN';
  icon = 'src/vi/lmvn/icon.png';
  site = 'https://lmvn.com';
  version = '1.0.0';

  fallbackSites = ['https://lmvn.com'];

  private async fetchWithFallback(pathOrUrl: string): Promise<string> {
    let fullUrl = pathOrUrl;
    if (!pathOrUrl.startsWith('http')) {
      if (pathOrUrl.startsWith('/')) {
        fullUrl = this.site + pathOrUrl;
      } else {
        fullUrl = `${this.site}/truyen/${pathOrUrl}`;
      }
    }

    try {
      const body = await fetchText(fullUrl);
      if (body && body.length > 200) {
        return body;
      }
    } catch {
      // Failed
    }
    throw new Error(`Failed to fetch from ${fullUrl}`);
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const url = `/truyen/index.php?func=main&cat=0&page=${pageNo}`;
    const body = await this.fetchWithFallback(url);
    const $ = loadCheerio(body);

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('a[href*="func=viewpost"]').each((_, a) => {
      let href = $(a).attr('href') || '';
      const name = $(a).text().trim();
      if (!href || !name || name.length < 2) return;

      if (!href.includes('/truyen/')) {
        href = `/truyen/${href.replace(/^\/?/, '')}`;
      }

      if (seen.has(href)) return;
      seen.add(href);

      novels.push({
        name,
        path: href,
        cover: defaultCover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const body = await this.fetchWithFallback(novelPath);
    const $ = loadCheerio(body);

    const pageTitle = $('title').text().trim();
    let title = pageTitle.replace(/\s*-\s*Truyen\.com\s*$/i, '').trim();

    let author = '';
    $('a[href*="tacgiaID="]').first().each((_, a) => {
      author = $(a).text().trim();
    });

    if (!author && title.includes('-')) {
      const parts = title.split('-');
      if (parts.length >= 2) {
        author = parts[parts.length - 1].trim();
        title = parts.slice(0, parts.length - 1).join('-').trim();
      }
    }

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: title,
      cover: defaultCover,
      author,
      status: NovelStatus.Completed,
    };

    const chapters: Plugin.ChapterItem[] = [];
    const seenChaps = new Set<string>();

    $('a[href*="&ssid="]').each((_, a) => {
      let href = $(a).attr('href') || '';
      let name = $(a).text().trim();
      if (!href || !name) return;

      href = href.replace(/^https?:\/\/[^/]+/, '');
      if (!href.includes('/truyen/')) {
        href = `/truyen/${href.replace(/^\/?/, '')}`;
      }

      if (seenChaps.has(href)) return;
      seenChaps.add(href);

      chapters.push({
        name,
        path: href,
      });
    });

    // If no multi-chapter links found, this is a one-shot or single story
    if (chapters.length === 0) {
      chapters.push({
        name: 'Toàn văn',
        path: novelPath,
      });
    }

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const body = await this.fetchWithFallback(chapterPath);
    const $ = loadCheerio(body);

    // Find main content container
    const container = $('div[style*="padding:0 0 0 10px"]').first();

    if (container.length > 0) {
      // Remove embedded tables, advertisements, and scripts
      container.find('table, script, style, .id8673').remove();
      return container.html() || '';
    }

    // Fallback: search any large text block
    let bestText = '';
    $('div, td').each((_, el) => {
      const text = $(el).clone().children().remove().end().text().trim();
      if (text.length > bestText.length && text.length > 500) {
        bestText = $(el).html() || '';
      }
    });

    return bestText;
  }

  async searchNovels(searchTerm: string): Promise<Plugin.NovelItem[]> {
    const url = `/truyen/index.php?func=search&keyword=${encodeURIComponent(searchTerm)}`;
    const body = await this.fetchWithFallback(url);
    const $ = loadCheerio(body);

    const novels: Plugin.NovelItem[] = [];
    const seen = new Set<string>();

    $('a[href*="func=viewpost"]').each((_, a) => {
      let href = $(a).attr('href') || '';
      const name = $(a).text().trim();
      if (!href || !name || name.length < 2) return;

      if (!href.includes('/truyen/')) {
        href = `/truyen/${href.replace(/^\/?/, '')}`;
      }

      if (seen.has(href)) return;
      seen.add(href);

      novels.push({
        name,
        path: href,
        cover: defaultCover,
      });
    });

    return novels;
  }
}

export default new LMVNPlugin();
