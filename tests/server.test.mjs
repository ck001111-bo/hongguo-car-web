import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
const password='test-password-long-enough';
const media=Buffer.alloc(2048,71);media.write('ftyp',4);
const source={home:async()=>({items:[{id:'123',title:'测试剧'}]}),search:async()=>{throw Error('upstream private URL must not leak');},detail:async()=>({id:'123',episodes:[{id:'456'}]}),stream:async()=>({total:media.length,chunk:async(a,b)=>media.subarray(a,b+1)})};
test('登录保护、同源校验、完整和分段视频以及会话隔离',async()=>{
 const app=createApp({source,password});app.listen(0,'127.0.0.1');await once(app,'listening');const base='http://127.0.0.1:'+app.address().port;
 const call=(p,o={})=>fetch(base+p,o);
 const login=async()=>{const r=await call('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 try{
  assert.equal((await call('/api/home')).status,401);
  assert.equal((await call('/')).status,200);
  assert.equal((await call('/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://other.example'},body:JSON.stringify({password})})).status,403);
  const cookie=await login(),headers={Cookie:cookie};
  assert.equal((await (await call('/api/home',{headers})).json()).items[0].title,'测试剧');
  assert.equal((await call('/api/home?page=-1',{headers})).status,400);
  const search=await call('/api/search?q=x',{headers});assert.equal(search.status,424);assert.doesNotMatch(await search.text(),/private URL/);
  const play=await (await call('/api/episodes/456/play',{headers})).json();
  const withoutCookie=await call(play.path,{headers:{Range:'bytes=0-1'}});assert.equal(withoutCookie.status,206);assert.equal((await withoutCookie.arrayBuffer()).byteLength,2);
  assert.equal((await call(play.path.split('?')[0])).status,401);
  assert.equal((await call(play.path.replace(/access=.*/,'access=invalid'))).status,401);
  const range=await call(play.path,{headers:{...headers,Range:'bytes=128-255'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 128-255/2048');assert.deepEqual(Buffer.from(await range.arrayBuffer()),media.subarray(128,256));
  const suffix=await call(play.path,{headers:{...headers,Range:'bytes=-10'}});assert.equal((await suffix.arrayBuffer()).byteLength,10);
  const full=await call(play.path,{headers});assert.equal(full.status,200);assert.deepEqual(Buffer.from(await full.arrayBuffer()),media);
  assert.equal((await call(play.path,{headers:{...headers,Range:'bytes=3000-'}})).status,416);
  const other=await login();assert.equal((await call(play.path,{headers:{Cookie:other}})).status,410);
  await call('/api/logout',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
  assert.equal((await call('/api/home',{headers})).status,401);
  assert.equal((await call(play.path)).status,401);
 }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
});
