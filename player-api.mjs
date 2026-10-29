import crypto from 'node:crypto';
export async function playerResponse({url,req,res,json,source,headers,streams,sessions,owner}){
 const action=url.searchParams.get('ac')||'list',page=Number(url.searchParams.get('pg')||1);
 if(!Number.isInteger(page)||page<1||page>100)return json(400,{error:'页码无效'});
 const episode=url.searchParams.get('episode');
 if(action==='play'){
  if(!/^\d{1,30}$/.test(episode||''))return json(400,{error:'集数编号无效'});
  const media=await source.stream(episode,true,'hls'),id=crypto.randomBytes(24).toString('hex'),access=crypto.randomBytes(24).toString('hex');
  sessions.set(owner,{expires:Date.now()+7*86400000});streams.set(id,{owner,access,media,expires:Date.now()+30*60000});while(streams.size>100)streams.delete(streams.keys().next().value);
  res.writeHead(302,{...headers,Location:'/media/'+id+(media.kind==='hls'?'/index.m3u8':'')+'?access='+access});return res.end();
 }
 if(!['list','detail','videolist'].includes(action))return json(400,{error:'操作不支持'});
 const ids=url.searchParams.get('ids');
 if(ids){
  if(!/^\d{1,30}$/.test(ids))return json(400,{error:'仅支持单个剧集编号'});
  const d=await source.detail(ids);
  const base=new URL('/player/api',`https://${req.headers.host}`);base.searchParams.set('key',url.searchParams.get('key'));base.searchParams.set('ac','play');
  const playlist=d.episodes.map(ep=>{const play=new URL(base);play.searchParams.set('episode',ep.id);return ep.title+'$'+play.href;}).join('#');
  return json(200,{code:1,page:1,pagecount:1,limit:1,total:1,list:[{vod_id:d.id,vod_name:d.title,vod_pic:d.cover,vod_content:d.description,vod_remarks:`共${d.episodes.length}集`,vod_play_from:'红果独立后台',vod_play_url:playlist}]});
 }
 const wd=(url.searchParams.get('wd')||'').trim();if(wd.length>80)return json(400,{error:'剧名过长'});
 const data=wd?await source.search(wd,page):await source.home(page);
 return json(200,{code:1,page,pagecount:data.items.length?page+1:page,limit:20,total:data.items.length,list:data.items.map(d=>({vod_id:d.id,vod_name:d.title,vod_pic:d.cover,vod_remarks:d.badge,type_name:'短剧'})),notice:data.notice||'目录可用不等于播放可用；播放时连接后台解析'});
}
