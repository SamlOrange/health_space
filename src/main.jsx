import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownUp, ArrowUpRight, Clock3, HeartPulse, Info, Search, ShieldCheck, Sparkles } from 'lucide-react';
import './style.css';

const demo = [];
function App(){
  const [videos,setVideos]=useState(demo), [meta,setMeta]=useState({updatedAt:null,source:'loading'}), [query,setQuery]=useState(''), [page,setPage]=useState(1);
  useEffect(()=>{fetch(`${import.meta.env.BASE_URL}videos.json`).then(r=>{if(!r.ok)throw new Error('加载失败');return r.json()}).then(d=>{setVideos(d.videos||[]);setMeta(d.meta||{})}).catch(()=>setMeta({source:'error',error:'新闻快照暂不可用'}))},[]);
  const filtered=videos.filter(v=>(v.title+' '+v.titleZh+' '+v.summaryZh+' '+v.category+' '+v.creator).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>a.id-b.id);
  const pageSize=10, pageCount=Math.max(1,Math.ceil(filtered.length/pageSize)), pageStart=(page-1)*pageSize;
  const pageItems=filtered.slice(pageStart,pageStart+pageSize);
  return <main className="shell">
    <nav><a className="brand" href="#"><span className="brand-icon"><HeartPulse size={20}/></span>脉知 <i>HEALTH PULSE</i></a><div className="nav-right"><span className="live"><b/>公开新闻快照</span></div></nav>
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> GLOBAL HEALTH NEWS · TOP 20</div><h1>控糖与代谢，<em>每日精选。</em></h1><p>聚焦血糖管理、胰岛素抵抗、糖尿病与糖尿病前期，<br className="desktop"/>每日筛选全球相关报道，快速读懂研究与健康动态。</p><div className="hero-meta"><span><Clock3 size={15}/> 每日快照</span><span className="dot-sep">·</span><span>近7天资讯</span><span className="dot-sep">·</span><span>精选 TOP 20</span></div></div><div className="hero-art"><div className="orbit orbit1"/><div className="orbit orbit2"/><div className="pulse-card"><HeartPulse size={60} strokeWidth={1.3}/><span>健康<br/>有数</span></div><div className="float-tag tag-a">✦ 科学阅读</div><div className="float-tag tag-b">GLOBAL</div><div className="float-tag tag-c">♡ 身心健康</div></div></section>
    <section className="section-head"><div><div className="section-kicker">DAILY TOP 20 <span/></div><h2>控糖与胰岛素抵抗资讯</h2><p className="sub">近7天全球相关报道，共20条，每页10条；点击查看原文</p></div><div className="list-tools"><label className="search"><Search size={16}/><input placeholder="搜索新闻或来源" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/></label><span className="sort"><ArrowDownUp size={15}/> 发布时间排序</span></div></section>
    <section className="list">{pageItems.map((v,i)=><article className="video" key={v.id}><div className={'rank '+(i<3?'top':'')}>{String(pageStart+i+1).padStart(2,'0')}</div><div className="thumb">{v.image?<img src={v.image} alt=""/>:<span>{v.emoji||'🌍'}</span>}<div className="play">↗</div><small>全球新闻</small></div><div className="video-body"><div className="chips"><span>{v.category}</span><small>{v.age}</small></div><h3>{v.titleZh||v.title}</h3>{v.titleZh&&v.titleZh!==v.title&&<div className="original-title">原文：{v.title}</div>}<div className="creator"><span className="avatar">{(v.creator||'健').slice(0,1)}</span><b>{v.creator||'健康创作者'}</b><span className="verified"><ShieldCheck size={13}/> 新闻来源</span></div><div className="summary">{v.summaryZh||'暂未获取到中文摘要，请点击原文查看。'}</div><div className="source-line">{v.summary}</div></div><div className="stats"><div><strong>{v.language||'NEWS'}</strong><small>{v.age}</small></div><a href={v.url||'#'} target={v.url?'_blank':undefined} rel="noreferrer" className="open">阅读原文 <ArrowUpRight size={15}/></a></div></article>)}{!filtered.length&&<div className="empty">没有找到相关报道，试试其他关键词。</div>}</section>
    {filtered.length>0&&<div className="pagination"><button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>上一页</button><span>第 {page} / {pageCount} 页 · 共 {filtered.length} 条</span><button onClick={()=>setPage(p=>Math.min(pageCount,p+1))} disabled={page===pageCount}>下一页</button></div>}
    <div className="note"><Info size={16}/><span>{meta.notice||'中文标题由机器翻译；摘要依据报道简介整理。医疗内容以原文和专业机构信息为准。'}{meta.updatedAt&&` 最近更新：${new Date(meta.updatedAt).toLocaleString('zh-CN')}`}</span></div>
    <footer><span>脉知 · HEALTH PULSE</span><span>来自全球媒体的医疗健康最新消息。</span></footer>
    {meta.source==='error'&&<div className="demo"><span>暂时无法更新</span>{meta.error}</div>}
  </main>
}
createRoot(document.getElementById('root')).render(<App/>);
