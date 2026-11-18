import fs from 'node:fs/promises';

const snapshotPath = new URL('../public/videos.json', import.meta.url);
const query = '(health OR healthcare OR medical OR medicine OR disease OR hospital OR vaccine OR cancer OR WHO OR public health)';
const params = new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '75', timespan: '1d', sort: 'HybridRel' });
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
if (!payload) {
  const previous = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
  previous.meta = { ...previous.meta, lastCheckedAt: new Date().toISOString() };
  await fs.writeFile(snapshotPath, JSON.stringify(previous, null, 2));
  console.warn(`Keeping previous snapshot: ${lastError?.message || 'news source unavailable'}`);
  process.exit(0);
}

const previousSnapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8').catch(() => '{\"videos\":[]}'));
const previousByUrl = new Map((previousSnapshot.videos || []).map((item) => [item.url, item]));
const seen = new Set();
const candidates = (payload.articles || []).filter((article) => {
  const key = (article.title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').slice(0, 70);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
}).slice(0, 10);
if (!candidates.length) throw new Error('GDELT returned no health news; refusing to publish an empty snapshot.');

const articles = [];
for (const [index, article] of candidates.entries()) {
  const originalTitle = clean(article.title || 'Untitled health news');
  const description = article.url ? await fetchDescription(article.url, originalTitle) : '';
  const previous = previousByUrl.get(article.url);
  const titleZh = await translate(originalTitle, article.language) || previous?.titleZh || originalTitle;
  const summarySource = selectSummary(description);
  const translatedSummary = summarySource ? await translate(summarySource, article.language) : '';
  const summaryZh = isUsefulSummary(translatedSummary) ? translatedSummary : isUsefulSummary(previous?.summaryZh) ? previous.summaryZh : '原文简介过短或暂不可用；请点击原文查看详情。';
  articles.push({
    id: index + 1,
    title: originalTitle,
    titleZh: titleZh || originalTitle,
    category: '全球健康',
    creator: article.domain || article.sourcecountry || '新闻来源',
    age: formatAge(article.seendate),
    emoji: ['🌍', '🧬', '🩺', '🧪', '💉'][index % 5],
    summary: `来源：${article.domain || article.sourcecountry || '国际媒体'} · ${article.language || '多语种新闻'}`,
    summaryZh,
    url: article.url || null,
    image: article.socialimage || null,
    language: article.language || '',
  });
  // MyMemory's anonymous free tier is limited by characters per day; pacing also reduces 429s.
  await delay(180);
}

const snapshot = {
  videos: articles,
  meta: {
    source: 'gdelt',
    updatedAt: new Date().toISOString(),
    notice: '中文标题由机器翻译；摘要依据新闻页面简介翻译整理。内容以原文为准，不构成医疗建议。热度按 GDELT 趋势/相关度排序。',
  },
};
await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
console.log(`Saved ${articles.length} stories with Chinese titles and summaries.`);

async function fetchDescription(url, title) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HealthPulseNews/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return '';
    const html = await response.text();
    const descriptions = new Map();
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = match[0];
      const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1].toLowerCase(), decode(m[2])]));
      const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
      if (['og:description', 'description', 'twitter:description'].includes(key) && attrs.content) descriptions.set(key, attrs.content);
    }
    const metaDescription = descriptions.get('og:description') || descriptions.get('description') || descriptions.get('twitter:description') || '';
    if (metaDescription.length >= 90) return metaDescription;
    const body = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => clean(match[1]))
      .filter((text) => text.length >= 90 && text.length <= 2000 && text.split(/\s+/).length >= 14)
      .filter((text) => !/subscribe|newsletter|sign up|read more|click here|cookie policy/i.test(text));
    const titleTerms = clean(title).toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4);
    body.sort((a, b) => scoreParagraph(b, titleTerms) - scoreParagraph(a, titleTerms));
    return body[0] || metaDescription;
  } catch (error) {
    console.warn(`Could not read article description: ${error.message}`);
    return '';
  }
}

function selectSummary(text) {
  const normalized = clean(text);
  if (!normalized) return '';
  const shortened = normalized.slice(0, 220);
  return shortened.length < normalized.length ? shortened.replace(/\s+\S*$/, '').trim() : shortened;
}
function scoreParagraph(text, terms) {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
}
function isUsefulSummary(value) {
  if (!value) return false;
  return [...value].filter((char) => /[\u3400-\u9fffA-Za-z0-9]/.test(char)).length >= 24;
}

async function translate(text, languageName) {
  if (!text) return '';
  if (/[\u3400-\u9fff]/.test(text)) return text;
  const source = langCode(languageName);
  try {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text.slice(0, 220));
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
