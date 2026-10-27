import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import axios from "axios";
import {getDevice,userAgent} from './device.mjs';
import {createInitializationCache} from './device-state.mjs';
import {browserCompatible,cachedBrowserMedia} from './transcode.mjs';
import {playbackPayload} from './playback-request.mjs';

// Trusted, pinned GPL source. This is a compatibility wrapper, not a sandbox for user scripts.
let source = fs.readFileSync(
  new URL("./vendor/hongguo.cjs", import.meta.url),
  "utf8"
);
source=source.replace('const VIDEO_API =','let VIDEO_API =').replace('branchOf(url, body, khronos) !== 1','branchOf(url, body, khronos) === 0');
source=source.replace("[22,'16']","[22,DEVICE.os_version||'16']").replace("[24,36,'sint']","[24,Number(DEVICE.os_api||36),'sint']");
for(const [field,fallback] of [[30,'25053RT47C'],[31,'Redmi'],[32,'25053RT47C'],[33,'25053RT47C'],[35,'Redmi'],[36,'Redmi']]){
 const name=[31,35,36].includes(field)?'device_brand':'device_type';
 source=source.replaceAll(`[${field},'${fallback}']`,`[${field},DEVICE.${name}||'${fallback}']`);
}
source=source.replace("[34,'Xiaomi']","[34,/samsung/i.test(DEVICE.device_brand)?'Samsung':/redmi|xiaomi/i.test(DEVICE.device_brand)?'Xiaomi':DEVICE.device_brand]");
const context = vm.createContext({
  require: (name) => {
    if (name === "node:crypto") return crypto;
    throw new Error("Unsupported module");
  },
  Buffer,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  axios: axios.create({
    maxContentLength: 16 * 1024 * 1024,
    maxBodyLength: 1024 * 1024,
    timeout: 15000,
  }),
});
vm.runInContext(
  source +
    "\nthis.api = {categoryPage, categoryData, itemToCard, appSearchPage, routerData, resolveStream, prepareHeader, remoteRange, decryptPartial, streamCache, videoInfoCache, pageCache, appSearchCache,modelForVideo,parseFallback,qualityRows,signedVideoRequest,setEndpoint: p=>{VIDEO_API='https://api5-normal-sinfonlineb.fqnovel.com'+p},setDevice:d=>{const {cookies,...values}=d;Object.assign(DEVICE,values);Object.assign(APP_DEVICE,values)}};",
  context,
  { timeout: 5000 }
);
const api = context.api;
const initialize=createInitializationCache(async()=>{const d=await getDevice();api.setDevice(d);return d;});
async function freshInfo(id){
  const d=await initialize();
  const videoUa=`com.phoenix.read/71332 (Linux; U; Android ${d.os_version||'16'}; zh_CN; ${d.device_type||'25053RT47C'}; Build/${(d.rom_version||'BP2A.250605.031.A3').split(' ')[0]}; Cronet/TTNetVersion:04657795 2026-01-23 QuicVersion:c67e9834 2025-09-08)`;
  const paths=['/novel/player/multi_video_model/v1/','/novel/player/video_model/v1/'];
  let failure;
  for(const p of paths){
    api.setEndpoint(p);
    try{
      const payload=playbackPayload(id,p.includes('/player/video_model/'));
      const signed=api.signedVideoRequest(payload);
      const r=await axios.post(signed.url,signed.body,{timeout:15000,maxContentLength:2*1024*1024,headers:{...signed.headers,'User-Agent':videoUa,'passport-sdk-version':'6031190','Content-Type':'application/json; charset=utf-8','X-SS-DP':'8662','Accept-Language':'zh-CN,zh;q=0.9','X-Tt-Store-Region':'cn','X-Tt-Store-Region-Src':'did'}});
      const model=api.modelForVideo(r.data,id),fallback=api.parseFallback(model.fallback_api);
      const u=new URL(fallback);
      if(u.protocol!=='https:'||!/(^|\.)(fqnovel\.com|snssdk\.com|ixigua\.com|bytevideo\.cn|toutiao\.com)$/.test(u.hostname))throw Error('片源地址域名不符合预期');
      const outer=(await axios.get(u.href,{timeout:10000,maxContentLength:4*1024*1024,headers:{'User-Agent':userAgent}})).data;
      const info=outer?.video_info?.data,rows=api.qualityRows(info?.video_list);
      if(!rows?.length)throw Error('没有可用清晰度');
      api.videoInfoCache.set(id,{time:Date.now(),value:{model,info,rows}});
      const compatible=rows.filter(r=>!['bytevc2','bvc2'].includes(String(r.item.codec_type).toLowerCase()));
      const size=r=>Math.min(Number(r.item.vwidth)||Infinity,Number(r.item.vheight)||Infinity);
      const within=compatible.filter(r=>size(r)<=540).sort((a,b)=>size(b)-size(a));
      return (within[0]||compatible.sort((a,b)=>size(a)-size(b))[0])?.key||'auto';
    }catch(e){failure=e;}
  }
  throw failure||Error('App 片源暂不可用');
}
const SITE = "https://hongguoduanju.com";
const catalogCache=new Map();
const streamJobs=new Map();
const card = (row) => ({
  id: String(row.url),
  title: row.title,
  cover: row.img || "",
  description: row.content || "",
  badge: row.desc || "",
  tags: row.tname || "",
});
const cards = (rows) =>
  Array.from(rows)
    .filter((r) => /^\d+$/.test(String(r.url)) && r.title)
    .map(card);

export const provider = {
  async home(page = 1) {
    const data = await api.categoryPage("tab=1&sort_type=1", page);
    const pageData =
      data?.loaderData?.category_page || data?.loaderData?.["category_$"];
    if (!Array.isArray(pageData?.recommendList))
      throw new Error("首页数据结构已变化");
    const items=cards(pageData.recommendList.map(api.itemToCard));
    for(const item of items)catalogCache.set(item.id,item);
    while(catalogCache.size>1000)catalogCache.delete(catalogCache.keys().next().value);
    return { items, page };
  },
  async search(keyword, page = 1) {
    try {
      await initialize();
      const result = await api.appSearchPage(keyword, 11, page, 20);
      if (result.list.length) return { items: cards(result.list), page };
    } catch {
      /* Website fallback; failure below remains an error, never an empty success. */
    }
    let data;
    try{data = await api.routerData(
      `${SITE}/search/${encodeURIComponent(keyword)}?page=${page}`
    );}catch{
      const items=[...catalogCache.values()].filter(x=>x.title.includes(keyword)).slice((page-1)*20,page*20);
      return {items,page,notice:'全站搜索暂不可用，当前仅匹配已加载的片单。'};
    }
    const pageData =
      data?.loaderData?.["search_(keyword)/page"] ||
      data?.loaderData?.search_page;
    if (!Array.isArray(pageData?.searchList)) throw new Error("搜索数据不可用");
    return { items: cards(pageData.searchList.map(api.itemToCard)), page };
  },
  async detail(id) {
    const data = await api.routerData(`${SITE}/detail?series_id=${id}`);
    const series = data?.loaderData?.detail_page?.seriesDetail;
    if (!series || !Array.isArray(series.vid_list) || !series.vid_list.length)
      throw new Error("剧集不存在或分集暂不可用");
    const episodes = Array.from(series.vid_list, (vid, index) => ({
      id: String(vid),
      title: `第 ${index + 1} 集`,
      number: index + 1,
    }));
    if (
      episodes.some((e) => !/^\d+$/.test(e.id)) ||
      new Set(episodes.map((e) => e.id)).size !== episodes.length
    )
      throw new Error("分集数据异常");
    return { ...card(api.itemToCard(series)), id, episodes };
  },
  stream(id,fresh=false){
    if(streamJobs.has(id))return streamJobs.get(id);
    if(streamJobs.size>=8)return Promise.reject(Error('准备队列已满，请稍后再试'));
    const job=this.prepareStream(id,fresh).finally(()=>streamJobs.delete(id));streamJobs.set(id,job);return job;
  },
  async prepareStream(id, fresh = false) {
    if(process.env.HGTV_FFMPEG){const cached=await cachedBrowserMedia(id);if(cached)return cached;}
    if (fresh) {
      api.streamCache.delete(`${id}|auto`);
      api.videoInfoCache.delete(id);
    }
    const quality=await freshInfo(id);
    const stream=await api.resolveStream(id,quality);
    const prepared = await api.prepareHeader(stream);
    const media = {
      total: prepared.total,
      chunk: async (start, end) =>
        api.decryptPartial(
          (await api.remoteRange(stream, start, end)).data,
          start,
          stream.key,
          prepared
        ),
    };
    return process.env.HGTV_FFMPEG?browserCompatible(id,media):media;
  },
};

// Limit the pinned upstream's otherwise unbounded caches during long-lived home use.
setInterval(() => {
  for (const cache of [
    api.streamCache,
    api.videoInfoCache,
    api.pageCache,
    api.appSearchCache,
  ]) {
    for (const [key, value] of cache)
      if (Date.now() - value.time > 300000) cache.delete(key);
    while (cache.size > 100) cache.delete(cache.keys().next().value);
  }
}, 60000).unref();
