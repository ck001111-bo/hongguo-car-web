import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server.mjs';
import {provider} from '../provider.mjs';
const directory=new URL('../',import.meta.url);
if(!process.env.HGTV_FFMPEG){try{process.env.HGTV_FFMPEG=JSON.parse(await fs.readFile(new URL('.local-runtime.json',directory),'utf8')).ffmpeg;}catch{}}
const id=process.argv[2]||'7694655342478642201';
const password=crypto.randomBytes(24).toString('hex');
const app=createApp({source:provider,password});await new Promise(r=>app.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+app.address().port;
try{
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const preparedAt=performance.now();const response=await fetch(base+'/api/episodes/'+id+'/play',{headers});const media=await response.json();if(!response.ok)throw Error('媒体准备失败');const preparationMs=performance.now()-preparedAt;
 const initialRSS=process.memoryUsage().rss;let peakRSS=initialRSS,next=0;const samples=[];
 const workers=Array.from({length:4},async()=>{while(next<24){const n=next++;const start=(n*65536)%(media.bytes-131072);const end=start+131071;const at=performance.now();const r=await fetch(base+media.path,{headers:{...headers,Range:`bytes=${start}-${end}`}});const bytes=await r.arrayBuffer();if(r.status!==206||bytes.byteLength!==131072)throw Error('Range 并发读取校验失败');samples.push(performance.now()-at);peakRSS=Math.max(peakRSS,process.memoryUsage().rss);}});await Promise.all(workers);
 samples.sort((a,b)=>a-b);const report={at:new Date().toISOString(),episodeId:id,preparedBytes:media.bytes,preparationMs:Math.round(preparationMs),rangeRequests:24,concurrency:4,rangeBytes:131072,p50Ms:Math.round(samples[11]),p95Ms:Math.round(samples[22]),rssIncreaseMiB:Math.round((peakRSS-initialRSS)/1024/1024),scope:'local loopback, cached prepared episode; excludes cold upstream and car network'};
 const destination=process.argv[3]||fileURLToPath(new URL('.runtime/performance-report.json',directory));await fs.writeFile(destination,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{app.closeAllConnections();await new Promise(r=>app.close(r));}
