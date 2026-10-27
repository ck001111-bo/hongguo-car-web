import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {provider} from './provider.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const sessions=new Map(), streams=new Map(), attempts=new Map();
const COOKIE='hg_session';
const MAX_SESSION=7*24*3600_000;
const hash=x=>crypto.createHash('sha256').update(x).digest();
const same=(a,b)=>crypto.timingSafeEqual(hash(a),hash(b));
export function createApp({source=provider,password,secureCookie=false}={}) {
  if(!password || password.length<12) throw Error('访问密码至少需要 12 个字符');
  const server=http.createServer(async(req,res)=>{
    const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
    const json=(status,value)=>{res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    let url;
    try{url=new URL(req.url,'http://localhost');}catch{return json(400,{error:'请求地址无效'});}
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
    const session=sessions.get(token);
    const logged=!!session&&session.expires>Date.now();
    const origin=req.headers.origin;
    if(origin){try{const o=new URL(origin);if(o.host!==req.headers.host)return json(403,{error:'请求来源不正确'});}catch{return json(403,{error:'请求来源不正确'});}}
    if(req.method==='POST' && !String(req.headers['content-type']||'').startsWith('application/json'))return json(415,{error:'请求格式不正确'});
    try {
      if(url.pathname==='/api/login' && req.method==='POST'){
        const ip=req.socket.remoteAddress;let attempt=attempts.get(ip);
        if(attempt&&attempt.until<Date.now()){attempts.delete(ip);attempt=null;}
        if(attempt?.count>=10)return json(429,{error:'尝试过于频繁，请 15 分钟后重试'});
        let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return json(413,{error:'请求过大'});}
        let input;try{input=JSON.parse(body);}catch{return json(400,{error:'请求格式不正确'});}
        if(typeof input.password!=='string'||!same(input.password,password)){
          attempts.set(ip,{count:(attempt?.count||0)+1,until:attempt?.until||Date.now()+900_000});return json(401,{error:'访问密码不正确'});
        }
        attempts.delete(ip);const id=crypto.randomBytes(32).toString('hex');sessions.set(id,{expires:Date.now()+MAX_SESSION});
        for(const [key,value] of sessions)if(value.expires<Date.now())sessions.delete(key);
        while(sessions.size>1000)sessions.delete(sessions.keys().next().value);
        res.setHeader('Set-Cookie',`${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_SESSION/1000}${secureCookie?'; Secure':''}`);
        return json(200,{ok:true});
      }
      if(url.pathname==='/api/session')return json(200,{authenticated:logged});
      if(url.pathname==='/health')return json(200,{service:'hongguo-web',status:'running',playback:'unverified'});
      const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
      if(files[url.pathname] && ['GET','HEAD'].includes(req.method)){
        const file=files[url.pathname],content=await fs.readFile(path.join(root,'public',file));
        res.writeHead(200,{...headers,'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'});return res.end(req.method==='HEAD'?undefined:content);
      }
      if(!logged)return json(401,{error:'请先输入访问密码'});
      if(url.pathname==='/api/logout'&&req.method==='POST'){sessions.delete(token);res.setHeader('Set-Cookie',`${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);return json(200,{ok:true});}
      if(!['GET','HEAD'].includes(req.method))return json(405,{error:'请求方式不支持'});
      const page=Number(url.searchParams.get('page')||1);
      if(!Number.isInteger(page)||page<1||page>100)return json(400,{error:'页码无效'});
      if(url.pathname==='/api/home')return json(200,await source.home(page));
      if(url.pathname==='/api/search'){
        const q=(url.searchParams.get('q')||'').trim();if(!q||q.length>80)return json(400,{error:'请输入 1–80 字的剧名'});
        return json(200,await source.search(q,page));
      }
      const detail=url.pathname.match(/^\/api\/series\/(\d{1,30})$/);
      if(detail)return json(200,await source.detail(detail[1]));
      const play=url.pathname.match(/^\/api\/episodes\/(\d{1,30})\/play$/);
      if(play){
        const id=crypto.randomBytes(24).toString('hex');const media=await source.stream(play[1],true);
        streams.set(id,{owner:token,media,expires:Date.now()+30*60_000});
        while(streams.size>24)streams.delete(streams.keys().next().value);
        return json(200,{path:'/media/'+id,bytes:media.total,episode:play[1]});
      }
      const stream=url.pathname.match(/^\/media\/([a-f0-9]{48})$/);
      if(stream){
        const entry=streams.get(stream[1]);if(!entry||entry.owner!==token||entry.expires<Date.now())return json(410,{error:'播放地址已过期，请重新选集'});
        const total=entry.media.total;const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range||'');
        if(req.headers.range&&!match){res.writeHead(416,{...headers,'Content-Range':`bytes */${total}`});return res.end();}
        let start=0,end=total-1;
        if(match){if(!match[1]&&match[2])start=Math.max(0,total-Number(match[2]));else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}}
        if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=total||end<start){res.writeHead(416,{...headers,'Content-Range':`bytes */${total}`});return res.end();}
        const first=req.method==='HEAD'?null:await entry.media.chunk(start,Math.min(end,start+512*1024-1));
        res.writeHead(match?206:200,{...headers,'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${total}`}:{})});
        if(req.method==='HEAD')return res.end();
        let next=start;const write=async b=>{if(!res.write(b))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});};
        await write(first);next+=first.length;
        while(next<=end&&!res.destroyed){const b=await entry.media.chunk(next,Math.min(end,next+512*1024-1));if(!b.length)throw Error('媒体数据中断');await write(b);next+=b.length;}
        return res.end();
      }
      return json(404,{error:'没有这个页面'});
    }catch(error){
      console.error(JSON.stringify({event:'request_failed',path:url.pathname,code:error.code||'UPSTREAM_ERROR'}));
      if(res.headersSent)return res.destroy();
      if(error.code==='DEVICE_REGISTRATION_REJECTED')return json(424,{error:'当前片源连接未完成，请等待修复。重复点击暂时不能恢复播放。',code:error.code});
      return json(424,{error:'片源暂不可用，请稍后重试。网页不会用预览片代替完整内容。'});
    }
  });
  server.requestTimeout=90_000;server.headersTimeout=15_000;
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let runtime={};try{runtime=JSON.parse(await fs.readFile(path.join(root,'.local-runtime.json'),'utf8'));}catch{}
  process.env.HGTV_FFMPEG ||= runtime.ffmpeg||'ffmpeg';
  const encoder=spawnSync(process.env.HGTV_FFMPEG,['-version'],{timeout:10000,windowsHide:true,stdio:'ignore'});
  if(encoder.status!==0)throw Error('未找到 FFmpeg，请先安装并设置 HGTV_FFMPEG 或 .local-runtime.json');
  let config={};try{config=JSON.parse(await fs.readFile(path.join(root,'.private-config.json'),'utf8'));}catch{}
  if(!config.password&&!process.env.APP_PASSWORD){config.password=crypto.randomBytes(18).toString('base64url');await fs.writeFile(path.join(root,'.private-config.json'),JSON.stringify(config));}
  const app=createApp({password:process.env.APP_PASSWORD||config.password,secureCookie:process.env.COOKIE_SECURE==='1'});
  app.listen(Number(process.env.PORT||8790),process.env.HOST||'127.0.0.1',()=>console.log('红果网页已启动：http://127.0.0.1:'+(process.env.PORT||8790)));
}
