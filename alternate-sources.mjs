import axios from 'axios';
import sources from './sources.json' with {type:'json'};
const references=new Map();
const normalized=text=>String(text).normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
export function parseEpisodes(row){
 const lines=String(row.vod_play_url||'').split('$$$');
 for(const line of lines){
  const episodes=line.split('#').map((part,index)=>{const at=part.indexOf('$');return {title:part.slice(0,at)||`第 ${index+1} 集`,url:part.slice(at+1)};}).filter(ep=>/^https:\/\//.test(ep.url)&&/\.(m3u8|mp4)(?:[?#]|$)/i.test(ep.url));
  if(episodes.length)return episodes;
 }
 return [];
}
async function query(source,params){
 const response=await axios.get(source.api,{params:{ac:'videolist',...params},timeout:8000,maxContentLength:4*1024*1024});
 if(!Array.isArray(response.data?.list))throw Error('不是有效采集接口');return response.data;
}
export async function alternateSearch(keyword){
 const results=await Promise.all(sources.filter(s=>s.enabled).map(async s=>{
  try{const data=await query(s,{wd:keyword});return {source:s.name,status:'catalog-ok',items:data.list.filter(row=>normalized(row.vod_name).includes(normalized(keyword))).slice(0,12).map(row=>{
   const ref=s.key+'-'+row.vod_id;references.set(ref,{source:s,row});return {ref,title:String(row.vod_name),source:s.name,episodes:parseEpisodes(row).length,status:'未验证播放'};
  })};}catch{return {source:s.name,status:'unavailable',items:[]};}
 }));
 while(references.size>300)references.delete(references.keys().next().value);
 return {results,notice:'同名可能是合集、剪辑或不同版本，请核对标题与集数；搜到目录不代表可播放。'};
}
export async function alternateDetail(ref){
 let entry=references.get(ref);
 if(!entry){const match=/^([a-z]+)-(\d{1,30})$/.exec(ref);const source=match&&sources.find(s=>s.enabled&&s.key===match[1]);if(source)entry={source,row:{vod_id:match[2]}};}
 if(!entry)throw Error('搜索结果已过期，请重新搜索');
 const data=await query(entry.source,{ids:String(entry.row.vod_id)});const row=data.list[0];if(!row)throw Error('目录已失效');
 const episodes=parseEpisodes(row);if(!episodes.length)throw Error('此结果没有可直接播放的视频链接');
 return {id:'alt-'+ref,title:String(row.vod_name),source:entry.source.name,cover:'',description:'备用来源，集数可能与红果不同。请自行核对版本。',episodes:episodes.map((ep,i)=>({id:ref+'-'+i,title:ep.title,number:i+1,path:ep.url,kind:/\.m3u8(?:[?#]|$)/i.test(ep.url)?'hls':'mp4'}))};
}
