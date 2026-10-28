import http from 'node:http';
import fs from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {createLimiter} from './work-queue.mjs';

const root=new URL('./.runtime/',import.meta.url), jobs=new Map(), run=createLimiter(1,8);
const segmentName=/^segment-\d{5}\.ts$/;
async function cleanup(){
 const completed=[];
 for(const name of await fs.readdir(root)){
  const match=/^(\d+)-hls-v1$/.exec(name);if(!match||jobs.has(match[1]))continue;
  const folder=new URL(name+'/',root),stat=await fs.stat(folder);completed.push({folder,time:stat.mtimeMs});
 }
 completed.sort((a,b)=>b.time-a.time);
 for(const [index,item] of completed.entries())if(index>=64||Date.now()-item.time>25*3600000)await fs.rm(item.folder,{recursive:true,force:true});
}
function mediaAt(folder,state={done:true,error:null}){
 return {kind:'hls',state,async asset(name){
  if(name!=='index.m3u8'&&!segmentName.test(name))throw Error('无效媒体文件');
  if(state.error)throw state.error;
  return fs.readFile(new URL(name,folder));
 }};
}
export async function cachedProgressive(id){
 if(!/^\d{1,30}$/.test(id))return null;
 if(jobs.has(id))return jobs.get(id);
 const folder=new URL(id+'-hls-v1/',root);
 try{
  const stat=await fs.stat(new URL('index.m3u8',folder));
  if(Date.now()-stat.mtimeMs<24*3600000&&(await fs.readFile(new URL('index.m3u8',folder),'utf8')).includes('#EXT-X-ENDLIST'))return mediaAt(folder);
 }catch{}
 return null;
}

// FFmpeg reads only the source ranges it currently needs. No full-file download barrier.
async function sourceServer(media){
 const server=http.createServer(async(req,res)=>{
  const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  const start=match?Number(match[1]):0,end=match?.[2]?Math.min(Number(match[2]),media.total-1):media.total-1;
  if(!Number.isSafeInteger(start)||start>end||start<0){res.writeHead(416);return res.end();}
  res.writeHead(match?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${media.total}`}:{})});
  if(req.method==='HEAD')return res.end();
  const pending=new Map();let next=start;
  const fill=()=>{while(pending.size<4&&next<=end){const a=next,b=Math.min(end,a+512*1024-1);next=b+1;const task=Promise.resolve().then(()=>media.chunk(a,b));task.catch(()=>{});pending.set(a,task);}};
  try{
   fill();
   while(pending.size&&!res.destroyed){const [a,task]=pending.entries().next().value;const data=await task;pending.delete(a);if(!data.length)throw Error('片源数据中断');fill();if(!res.write(data))await new Promise(resolve=>{const done=()=>{res.off('drain',done);res.off('close',done);resolve();};res.once('drain',done);res.once('close',done);});}
   res.end();
  }catch{res.destroy();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port+'/input.mp4',close(){server.closeAllConnections();server.close();}};
}

export function progressiveMedia(id,media){
 if(jobs.has(id))return jobs.get(id);
 if(!/^\d{1,30}$/.test(id)||!Number.isSafeInteger(media.total)||media.total<=0||media.total>200*1024*1024)return Promise.reject(Error('视频大小超出处理限制'));
 let ready,failed;
 const result=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
 jobs.set(id,result);
 run(async()=>{
  const folder=new URL(id+'-hls-v1/',root),state={done:false,error:null};let gateway,process,timer;
  try{
   await fs.mkdir(root,{recursive:true});await cleanup();
   await fs.rm(folder,{recursive:true,force:true});await fs.mkdir(folder,{recursive:true});
   gateway=await sourceServer(media);
   process=spawn(globalThis.process.env.HGTV_FFMPEG,['-hide_banner','-loglevel','error','-y','-i',gateway.url,'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-vf',"scale=w='min(540,iw)':h=-2",'-r','30','-preset','veryfast','-crf','26','-profile:v','baseline','-level:v','3.1','-pix_fmt','yuv420p','-threads','2','-g','60','-keyint_min','60','-sc_threshold','0','-c:a','aac','-profile:a','aac_low','-b:a','96k','-ac','2','-ar','44100','-f','hls','-hls_time','2','-hls_playlist_type','event','-hls_flags','independent_segments+temp_file','-hls_segment_filename',fileURLToPath(new URL('segment-%2505d.ts',folder)),fileURLToPath(new URL('index.m3u8',folder))],{windowsHide:true,stdio:['ignore','ignore','pipe']});
   let diagnostic='';process.stderr.on('data',data=>{diagnostic=(diagnostic+data.toString()).slice(-2000);});
   const complete=new Promise((resolve,reject)=>{process.once('error',reject);process.once('exit',code=>code===0?resolve():reject(Error('本集准备中断')));});complete.catch(()=>{});
   timer=setTimeout(()=>process.kill(),180000);
   let finished=false;complete.then(()=>finished=true,()=>finished=true);
   while(!finished){
    try{const playlist=await fs.readFile(new URL('index.m3u8',folder),'utf8');if(playlist.includes('#EXTINF:')){ready(mediaAt(folder,state));break;}}catch{}
    await pause(100);
   }
   await complete.catch(error=>{if(globalThis.process.env.HGTV_DIAGNOSTIC==='1')console.error(diagnostic);throw error;});state.done=true;ready(mediaAt(folder,state));
  }catch(error){state.error=Error('本集准备中断，请重新选集');failed(state.error);await fs.rm(folder,{recursive:true,force:true}).catch(()=>{});}
  finally{clearTimeout(timer);gateway?.close();jobs.delete(id);}
 }).catch(error=>{jobs.delete(id);failed(error);});
 return result;
}
