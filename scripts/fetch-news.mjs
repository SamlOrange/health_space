import fs from 'node:fs/promises';

const query = '(health OR healthcare OR medical OR medicine OR disease OR hospital OR vaccine OR cancer OR WHO OR public health)';
const params = new URLSearchParams({
  query,
  mode: 'ArtList',
  format: 'json',
  maxrecords: '75',
  timespan: '1d',
  sort: 'HybridRel',
});
const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
  headers: { 'User-Agent': 'HealthPulseNews/1.0 (static daily news digest)' },
});
if (!response.ok) throw new Error(`GDELT returned HTTP ${response.status}`);
const payload = await response.json();
const seen = new Set();
const articles = (payload.articles || []).filter((article) => {
  const key = (article.title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').slice(0, 70);
  if (!key || seen.has(key)) return false;
  seen.add(key);
  return true;
}).slice(0, 10).map((article, index) => ({
  id: index + 1,
  title: article.title || 'Untitled health news',
  category: '全球健康',
  creator: article.domain || article.sourcecountry || '新闻来源',
  age: formatAge(article.seendate),
  emoji: ['🌍', '🧬', '🩺', '🧪', '💉'][index % 5],
  summary: `来源：${article.domain || article.sourcecountry || '国际媒体'} · ${article.language || '多语种新闻'}`,
  url: article.url || null,
  image: article.socialimage || null,
  language: article.language || '',
}));
if (!articles.length) throw new Error('GDELT returned no health news; refusing to publish an empty snapshot.');
const snapshot = {
  videos: articles,
  meta: {
    source: 'gdelt',
    updatedAt: new Date().toISOString(),
    notice: '按 GDELT 相关度/趋势排序；不是跨平台统一阅读量榜单。',
  },
};
await fs.writeFile(new URL('../public/videos.json', import.meta.url), JSON.stringify(snapshot, null, 2));
console.log(`Saved ${articles.length} news stories.`);

function formatAge(value) {
  if (!value) return '最近报道';
  const date = /^\d{8}T\d{6}Z?$/.test(value)
    ? new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return '最近报道';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  return minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : `${Math.floor(minutes / 1440)} 天前`;
}
