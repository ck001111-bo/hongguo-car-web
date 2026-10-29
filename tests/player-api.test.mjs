import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {parseEpisodes} from '../alternate-sources.mjs';
test('备用源只选直链线路，页面解析链接不伪装为视频',()=>{
 const row={vod_play_url:'正片$https://example.com/share/1$$$第1集$https://cdn.example/a.m3u8#第2集$https://cdn.example/b.mp4'};
 assert.equal(parseEpisodes(row).length,2);assert.equal(parseEpisodes({vod_play_url:'第1集$javascript:alert(1)'}).length,0);
});
test('播放器采集接口密钥、搜索、详情、重定向和无Cookie实际媒体',async()=>{
 const calls=[],app=createApp({password:'website-test-password',playerKey:'separate-player-secret',source:{home:async()=>({items:[]}),search:async q=>({items:[{id:'123',title:q}]}),detail:async()=>({id:'123',title:'测试',episodes:[{id:'456',title:'第1集'}]}),stream:async(...args)=>{calls.push(args);return {total:4,chunk:async()=>Buffer.from('test')};}}});
 app.listen(0,'127.0.0.1');await once(app,'listening');const base='http://127.0.0.1:'+app.address().port,key='key=separate-player-secret';
 try{
  assert.equal((await fetch(base+'/player/api')).status,401);assert.equal((await fetch(base+'/player/config')).status,401);const subscription=await(await fetch(base+'/player/config?'+key)).json();assert.equal(subscription.sites[0].type,1);assert.equal(new URL(subscription.sites[0].api).searchParams.get('key'),'separate-player-secret');
  const search=await (await fetch(base+'/player/api?'+key+'&wd=测试')).json();assert.equal(search.list[0].vod_id,'123');
  const detail=await (await fetch(base+'/player/api?'+key+'&ac=detail&ids=123')).json();const play=new URL(detail.list[0].vod_play_url.split('$')[1]);
  assert.equal(play.searchParams.get('episode'),'456');
  const redirect=await fetch(base+play.pathname+play.search,{redirect:'manual'});assert.equal(redirect.status,302);
  const media=await fetch(base+redirect.headers.get('location'));assert.equal(await media.text(),'test');assert.deepEqual(calls[0],['456',true,'hls']);
  assert.equal((await fetch(base+'/player/api?'+key+'&ac=play&episode=evil')).status,400);
  assert.equal((await fetch(base+'/player/api?'+key+'&ids=123,456')).status,400);
 }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
});
