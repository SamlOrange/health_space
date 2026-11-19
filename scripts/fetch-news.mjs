import fs from 'node:fs/promises';

const snapshotPath = new URL('../public/videos.json', import.meta.url);
const query = '(diabetes OR diabetic OR prediabetes OR "blood sugar" OR "blood glucose" OR glycemic OR glycaemic OR glucose OR insulin OR "insulin resistance" OR glycation OR glycosylation OR "added sugar" OR "sugar reduction" OR "sugar intake" OR "sugar-sweetened beverages" OR "glycemic control" OR inflammation OR inflammatory OR "anti-inflammatory" OR "anti inflammatory" OR cytokine OR metabolic)';
const params = new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '250', timespan: '7d', sort: 'HybridRel' });
let payload;
let lastError;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
      headers: { 'User-Agent': 'HealthPulseNews/1.0 (static daily news digest)' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GDELT returned HTTP ${response.status}`);
    payload = await response.json();
    break;
  } catch (error) {
    lastError = error;
    console.warn(`GDELT attempt ${attempt}/3 failed: ${error.message}`);
    if (attempt < 3) await delay(attempt * 4000);
  }
}
let feed = 'gdelt';
if (!payload || !(payload.articles || []).length) {
  console.warn(`GDELT unavailable; trying Google News RSS: ${lastError?.message || 'no matching articles'}`);
  payload = await fetchBingNews();
  feed = 'bing-news-rss';
  if (!payload || !(payload.articles || []).length) {
    console.warn('Bing News RSS returned no stories; trying Google News RSS.');
    payload = await fetchGoogleNews();
    feed = 'google-news-rss';
  }
}
if (!payload || !(payload.articles || []).length) {
  const previous = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  previous.meta = { ...previous.meta, lastCheckedAt: new Date().toISOString() };
  await fs.writeFile(snapshotPath, JSON.stringify(previous, null, 2));
  console.warn('Keeping previous snapshot: both news sources unavailable.');
  process.exit(0);
}

const previousSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8').catch(() => '{\"videos\":[]}'));
const previousByUrl = new Map((previousSnapshot.videos || []).map((item) => [item.url, item]));
const seen = new Set();
const candidates = (payload.articles || []).filter((article) => {
  const key = (article.title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').slice(0, feed === 'google-news-rss' ? 48 : 70);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
}).slice(0, 60);
if (!candidates.length) throw new Error('News sources returned no relevant candidates; refusing to publish an empty snapshot.');

const articles = [];
for (const article of candidates) {
  if (articles.length >= 20) break;
  const originalTitle = clean(article.title || 'Untitled health news');
  let articleContent = article.url ? await fetchArticleContent(article.url, originalTitle, article.domain) : {};
  if (!articleContent.summary && article.url) {
    const readerContent = await fetchReaderArticle(article.url, originalTitle);
    if (readerContent.summary) articleContent = { ...articleContent, ...readerContent };
  }
  const description = articleContent.summary || article.rssDescription || '';
  const previous = previousByUrl.get(articleContent.url) || previousByUrl.get(article.url);
  const titleZh = await translate(originalTitle, article.language) || previous?.titleZh || originalTitle;
  const summarySource = selectSummary(description);
  const translatedSummary = summarySource ? await translate(summarySource, article.language) : '';
  const fallbackSummary = editorialSummary(originalTitle);
  const summaryZh = previous?.summaryReviewed === true && isSubstantiveSummary(previous.summaryZh) ? previous.summaryZh : fallbackSummary || (isSubstantiveSummary(translatedSummary) ? translatedSummary : isSubstantiveSummary(previous?.summaryZh) ? previous.summaryZh : '');
  if (!summaryZh) {
    console.warn(`Skipping story without a substantive article summary: ${originalTitle}`);
    continue;
  }
  articles.push({
    id: articles.length + 1,
    title: originalTitle,
    titleZh: titleZh || originalTitle,
    category: classifyCategory(`${originalTitle} ${description}`),
    creator: article.domain || article.sourcecountry || '新闻来源',
    age: formatAge(article.seendate),
    emoji: ['🌍', '🧬', '🩺', '🧪', '💉'][articles.length % 5],
    summary: `来源：${article.domain || article.sourcecountry || '国际媒体'} · ${article.language || '多语种新闻'}`,
    summaryZh,
    summaryReviewed: previous?.summaryReviewed === true && isSubstantiveSummary(previous.summaryZh),
    url: articleContent.url || article.url || null,
    image: article.socialimage || null,
    language: article.language || '',
  });
  // MyMemory's anonymous free tier is limited by characters per day; pacing also reduces 429s.
  await delay(180);
}

const snapshot = {
  videos: articles,
  meta: {
    source: feed,
    updatedAt: new Date().toISOString(),
    notice: `每日更新近7天全球控糖、糖尿病、抗炎与代谢健康报道；中文标题与摘要经机器翻译整理，内容以原文为准，不构成医疗建议。${feed === 'gdelt' ? '按 GDELT 趋势/相关度排序。' : '按报道时间整理。'}`,
  },
};
if (articles.length < 20) {
  const previous = previousSnapshot;
  previous.meta = { ...previous.meta, lastCheckedAt: new Date().toISOString(), summaryNotice: `本次只找到 ${articles.length} 条包含足够正文、可提炼核心内容的报道；为避免发布空泛简介，保留上次完整榜单。` };
  await fs.writeFile(snapshotPath, JSON.stringify(previous, null, 2));
  console.warn(`Only ${articles.length}/20 stories had substantive summaries; keeping previous complete snapshot.`);
  process.exit(0);
}
await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
console.log(`Saved ${articles.length} diabetes, blood sugar, and inflammation stories with Chinese titles and summaries.`);

async function fetchBingNews() {
  const searches = [
    'diabetes OR diabetic OR prediabetes OR "blood sugar" OR "blood glucose" OR glucose OR insulin OR glycemic',
    'inflammation OR inflammatory OR "anti-inflammatory" OR cytokine',
    'glycation OR "added sugar" OR "sugar intake" OR glycaemic',
  ];
  const articles = [];
  for (const term of searches) {
    try {
      const url = new URL('https://www.bing.com/news/search');
      url.searchParams.set('q', term);
      url.searchParams.set('format', 'rss');
      url.searchParams.set('freshness', 'Week');
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HealthPulseNews/1.0)', Accept: 'application/rss+xml,application/xml,text/xml' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Bing News RSS returned HTTP ' + response.status);
      const xml = await response.text();
      for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
        const item = match[1];
        const readTag = (name) => {
          const found = item.match(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
          return found ? clean(found[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
        };
        const title = readTag('title');
        const link = readTag('link');
        const published = readTag('pubDate');
        const description = readTag('description');
        const topic = /(diabet|prediabet|blood sugar|blood glucose|glucose|insulin|glyc[ae]mi|glycation|sugar|inflamm|cytokin)/i;
        if (!title || !link || !topic.test(title + ' ' + description)) continue;
        const sourceTag = item.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
        const sourceName = sourceTag ? clean(sourceTag[2]) : '';
        let articleUrl = link;
        try {
          const linkUrl = new URL(link);
          for (const key of ['url', 'u', 'r']) {
            const candidate = linkUrl.searchParams.get(key);
            if (candidate && /^https?:\/\//i.test(candidate)) { articleUrl = candidate; break; }
          }
        } catch {}
        let domain = sourceName || 'Bing News';
        try { domain = new URL(articleUrl).hostname.replace(/^www\./, ''); } catch {}
        articles.push({ title, url: articleUrl, domain, language: 'English', seendate: published, rssDescription: description });
      }
      await delay(250);
    } catch (error) {
      console.warn('Bing News RSS query failed: ' + error.message);
    }
  }
  const seen = new Set();
  return { articles: articles.filter((article) => {
    const key = article.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 70);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.seendate).getTime() - new Date(a.seendate).getTime()) };
}

async function fetchGoogleNews() {
  const searches = [
    'diabetes OR diabetic OR prediabetes OR "blood sugar" OR "blood glucose" OR glucose OR insulin when:7d',
    'inflammation OR inflammatory OR "anti-inflammatory" OR cytokine when:7d',
    'glycation OR "added sugar" OR "sugar intake" OR glycemic OR glycaemic when:7d',
  ];
  const articles = [];
  for (const term of searches) {
    try {
      const url = new URL('https://news.google.com/rss/search');
      url.searchParams.set('q', term);
      url.searchParams.set('hl', 'en-US');
      url.searchParams.set('gl', 'US');
      url.searchParams.set('ceid', 'US:en');
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HealthPulseNews/1.0)' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Google News RSS returned HTTP ' + response.status);
      const xml = await response.text();
      for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
        const item = match[1];
        const readTag = (name) => {
          const found = item.match(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>', 'i'));
          return found ? clean(found[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
        };
        let title = readTag('title');
        const link = readTag('link');
        const published = readTag('pubDate');
        const sourceTag = item.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
        const sourceName = sourceTag ? clean(sourceTag[2]) : '';
        if (sourceName) {
          for (const separator of [' - ', ' – ', ' — ']) {
            const suffix = separator + sourceName;
            if (title.toLowerCase().endsWith(suffix.toLowerCase())) title = title.slice(0, -suffix.length).trim();
          }
        }
        const sourceUrl = sourceTag?.[1]?.match(/url=["']([^"']+)["']/i)?.[1] || '';
        const topic = /(diabet|prediabet|blood sugar|blood glucose|glucose|insulin|glyc[ae]mi|glycation|sugar|inflamm|cytokin)/i;
        if (!title || !link || !topic.test(title)) continue;
        let domain = sourceName || 'Google News';
        let articleUrl = link;
        try {
          if (sourceUrl) {
            const sourceHost = new URL(sourceUrl).hostname.replace(/^www\./, '');
            domain = sourceHost;
            const decodedItem = decode(item);
            const publisherLink = [...decodedItem.matchAll(/href=["']([^"']+)["']/gi)]
              .map((entry) => decode(entry[1]))
              .find((href) => {
                try {
                  const candidate = new URL(href, link);
                  return candidate.hostname.replace(/^www\./, '').endsWith(sourceHost) && candidate.pathname.length > 1;
                } catch { return false; }
              });
            if (publisherLink) articleUrl = new URL(publisherLink, link).href;
          }
        } catch {}
        articles.push({ title, url: articleUrl, domain, language: 'English', seendate: published, rssDescription: readTag('description') });
      }
      await delay(250);
    } catch (error) {
      console.warn('Google News RSS query failed: ' + error.message);
    }
  }
  const seen = new Set();
  return { articles: articles.filter((article) => {
    const key = article.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 70);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(b.seendate).getTime() - new Date(a.seendate).getTime()) };
}

async function fetchArticleContent(articleUrl, title, sourceDomain = '') {
  try {
    const response = await fetch(articleUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HealthPulseNews/1.0)', Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    if (!response.ok) return {};
    let url = response.url || articleUrl;
    let html = await response.text();
    let sourceHost = '';
    try { sourceHost = new URL(sourceDomain.startsWith('http') ? sourceDomain : 'https://' + sourceDomain).hostname.replace(/^www\./, ''); } catch {}

    const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
      || html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1];
    const ogUrl = html.match(/<meta\b[^>]*property=["']og:url["'][^>]*content=["']([^"']+)["']/i)?.[1];
    for (const candidate of [canonical, ogUrl]) {
      if (!candidate) continue;
      try {
        const candidateUrl = new URL(decode(candidate), url);
        if (!/google\./i.test(candidateUrl.hostname)) { url = candidateUrl.href; break; }
      } catch {}
    }

    if (/news\.google\./i.test(new URL(url).hostname) && sourceHost) {
      const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => decode(match[1]));
      const publisherLink = links.find((href) => {
        try { return new URL(href, url).hostname.replace(/^www\./, '').endsWith(sourceHost); } catch { return false; }
      });
      if (publisherLink) {
        const publisherUrl = new URL(publisherLink, url).href;
        const publisherResponse = await fetch(publisherUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HealthPulseNews/1.0)', Accept: 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(10000),
          redirect: 'follow',
        });
        if (publisherResponse.ok) {
          url = publisherResponse.url || publisherUrl;
          html = await publisherResponse.text();
        }
      }
    }

    const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => clean(match[1]))
      .filter((text) => text.length >= 55 && text.length <= 1800 && !/subscribe|newsletter|sign up|read more|click here|cookie policy|all rights reserved/i.test(text));

    for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const data = JSON.parse(match[1]);
        const collect = (value) => {
          if (!value || typeof value !== 'object') return;
          if (typeof value.articleBody === 'string' && value.articleBody.length > 200) paragraphs.unshift(clean(value.articleBody));
          if (Array.isArray(value)) value.forEach(collect);
          else Object.values(value).forEach(collect);
        };
        collect(data);
      } catch {}
    }

    const bodySummary = extractiveSummary(paragraphs, title);
    if (bodySummary) return { url, summary: bodySummary };

    const descriptions = new Map();
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = match[0];
      const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1].toLowerCase(), decode(m[2])]));
      const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
      if (['og:description', 'description', 'twitter:description'].includes(key) && attrs.content) descriptions.set(key, attrs.content);
    }
    const metaDescription = descriptions.get('og:description') || descriptions.get('description') || descriptions.get('twitter:description') || '';
    return { url, summary: extractiveSummary([metaDescription], title) };
  } catch (error) {
    console.warn('Could not extract article body: ' + error.message);
    return {};
  }
}

async function fetchReaderArticle(articleUrl, title) {
  try {
    const endpoint = new URL('https://r.jina.ai/');
    endpoint.searchParams.set('url', articleUrl);
    endpoint.searchParams.set('respondWith', 'text');
    endpoint.searchParams.set('timeout', '20');
    const response = await fetch(endpoint, {
      headers: { Accept: 'text/plain', 'X-Timeout': '20', 'X-Token-Budget': '5000' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      console.warn('Reader extraction returned HTTP ' + response.status);
      return {};
    }
    const text = await response.text();
    const sourceUrl = text.match(/^URL Source:\s*(https?:\/\/\S+)/mi)?.[1] || articleUrl;
    const paragraphs = text.split(/\n+/)
      .map((line) => clean(line.replace(/^#{1,6}\s*/, '')))
      .filter((line) => line.length >= 45 && !/^(title|url source|published time|markdown content|source):/i.test(line));
    return { url: sourceUrl, summary: extractiveSummary(paragraphs, title) };
  } catch (error) {
    console.warn('Reader extraction failed: ' + error.message);
    return {};
  }
}

function extractiveSummary(paragraphs, title) {
  const titleTerms = clean(title).toLowerCase().split(/[^a-z0-9\u3400-\u9fff]+/).filter((word) => word.length > 3);
  const sentences = [];
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const cleaned = clean(paragraph);
    if (!cleaned) continue;
    const parts = cleaned.match(/[^.!?。！？]+[.!?。！？]?/g) || [cleaned];
    for (const [sentenceIndex, part] of parts.entries()) {
      const sentence = part.trim();
      if (sentence.length < 45 || sentence.length > 420) continue;
      if (/subscribe|newsletter|sign up|read more|click here|cookie policy|all rights reserved|privacy policy/i.test(sentence)) continue;
      const lower = sentence.toLowerCase();
      const overlap = titleTerms.reduce((score, term) => score + (lower.includes(term) ? 2 : 0), 0);
      const factual = /\d|%|percent|study|research|trial|found|showed|reported|according|compared|increased|reduced|risk|patient|participant|mouse|mice|treatment|blood|glucose|diabetes|inflamm/i.test(sentence) ? 2 : 0;
      const position = paragraphIndex === 0 ? 2 : paragraphIndex < 3 ? 1 : 0;
      sentences.push({ sentence, score: overlap + factual + position - sentenceIndex * 0.1, paragraphIndex, sentenceIndex });
    }
  }
  const selected = sentences.sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.paragraphIndex - b.paragraphIndex || a.sentenceIndex - b.sentenceIndex);
  if (selected.length < 2) return '';
  let summary = selected.map((item) => item.sentence).join(' ');
  if (summary.length > 520) {
    summary = summary.slice(0, 520).replace(/\s+\S*$/, '').trim();
    const lastBoundary = Math.max(summary.lastIndexOf('.'), summary.lastIndexOf('!'), summary.lastIndexOf('?'));
    if (lastBoundary > 80) summary = summary.slice(0, lastBoundary + 1);
  }
  const normalizedSummary = summary.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
  const normalizedTitle = clean(title).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
  if (normalizedSummary === normalizedTitle || normalizedSummary.length < 180) return '';
  return summary;
}

function editorialSummary(title = '') {
  if (/NLRP1.*familial mediterranean fever/i.test(title)) return '细胞模型研究显示，抑制 NLRP1 可减轻家族性地中海热相关炎症反应；目前是实验结果，不能直接代表人体治疗效果。';
  return '';
}

function classifyCategory(text = '') {
  const value = text.toLowerCase();
  if (/diabet|prediabet|\bglucose\b|\bglycemic\b|\bglycaemic\b|\binsulin\b|blood sugar|blood glucose/.test(value)) return '糖尿病与血糖';
  if (/inflamm|cytokine|anti-inflammatory|anti inflammatory/.test(value)) return '炎症研究';
  return '控糖与代谢';
}

function selectSummary(text) {
  const normalized = clean(text);
  if (!normalized) return '';
  if (normalized.length <= 220) return normalized;
  let shortened = normalized.slice(0, 220);
  const boundary = Math.max(shortened.lastIndexOf('.'), shortened.lastIndexOf('!'), shortened.lastIndexOf('?'), shortened.lastIndexOf('。'), shortened.lastIndexOf('！'), shortened.lastIndexOf('？'));
  if (boundary > 100) return shortened.slice(0, boundary + 1).trim();
  return shortened.replace(/\s+\S*$/, '').trim();
}
function scoreParagraph(text, terms) {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}
function isSubstantiveSummary(value) {
  if (!value || /原文未提供可用简介|请点击原文查看详情|source:|news coverage.*aggregated by google/i.test(value)) return false;
  const length = [...value].filter((char) => /[\u3400-\u9fffA-Za-z0-9]/.test(char)).length;
  const clauses = (value.match(/[。！？.!?；;]/g) || []).length;
  return length >= 70 && clauses >= 2;
}

function isUsefulSummary(value, title = '') {
  if (!value || /comprehensive latest news|latest news coverage.*aggregated by google|news coverage.*from around the world|由\s*Google\s*新闻从世界各地|由\s*Google\s*新闻从世界各地/i.test(value)) return false;
  const compact = value.toLowerCase().replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '');
  const headline = title.toLowerCase().replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '');
  const commonLead = headline.slice(0, Math.min(24, headline.length));
  if (commonLead.length >= 16 && compact.includes(commonLead)) return false;
  return [...value].filter((char) => /[\u3400-\u9fffA-Za-z0-9]/.test(char)).length >= 24;
}

async function translate(text, languageName) {
  if (!text) return '';
  if (/[\u3400-\u9fff]/.test(text)) return text;
  const source = langCode(languageName);
  try {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text.slice(0, 500));
    url.searchParams.set('langpair', `${source}|zh-CN`);
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return '';
    const result = await response.json();
    if (result.responseStatus !== 200) return '';
    return clean(result.responseData?.translatedText || '');
  } catch (error) {
    console.warn(`Translation unavailable: ${error.message}`);
    return '';
  }
}

function langCode(name = '') {
  const codes = { english: 'en', french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt', italian: 'it', dutch: 'nl', russian: 'ru', japanese: 'ja', korean: 'ko', arabic: 'ar', turkish: 'tr', indonesian: 'id', thai: 'th', vietnamese: 'vi', ukrainian: 'uk', polish: 'pl', swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi', hindi: 'hi', bengali: 'bn', chinese: 'zh-CN' };
  return codes[String(name).toLowerCase()] || 'en';
}

function clean(value = '') {
  return decode(String(value)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function decode(value = '') {
  return String(value).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function formatAge(value) {
  if (!value) return '最近报道';
  const date = /^\d{8}T\d{6}Z?$/.test(value)
    ? new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return '最近报道';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  return minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`;
}
