import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createLimiter} from './work-queue.mjs';
const exec=promisify(execFile),pending=new Map(),run=createLimiter(1,8);
const directory=new URL('./.runtime/',import.meta.url),suffix='-car-v2.mp4';
function fileMedia(output,total){return {total,chunk:async(start,end)=>{const file=await fs.open(output,'r');try{const buffer=Buffer.alloc(end-start+1);const {bytesRead}=await file.read(buffer,0,buffer.length,start);return buffer.subarray(0,bytesRead);}finally{await file.close();}}};}
export async function cachedBrowserMedia(id){
 if(!/^\d{1,30}$/.test(id))return null;
 const output=new URL(id+suffix,directory);
 try{const stat=await fs.stat(output);if(stat.size>0&&Date.now()-stat.mtimeMs<2*3600000)return fileMedia(output,stat.size);}catch{}
 return null;
}
export async function browserCompatible(id,media){
 if(pending.has(id))return pending.get(id);
 const promise=run(()=>convert(id,media)).finally(()=>pending.delete(id));pending.set(id,promise);return promise;
}
async function download(media,input){
 const handle=await fs.open(input,'w');let next=0;
 try{
  await handle.truncate(media.total);
  const jobs=Array.from({length:Math.min(4,Math.ceil(media.total/(1024*1024)))},async()=>{
   while(next<media.total){const start=next;next+=1024*1024;const end=Math.min(media.total-1,start+1024*1024-1);const chunk=await media.chunk(start,end);if(chunk.length!==end-start+1)throw Error('视频数据不完整');let written=0;while(written<chunk.length){const result=await handle.write(chunk,written,chunk.length-written,start+written);if(!result.bytesWritten)throw Error('视频缓存写入失败');written+=result.bytesWritten;}}
  });
  const results=await Promise.allSettled(jobs);const failed=results.find(x=>x.status==='rejected');if(failed)throw failed.reason;
 }finally{await handle.close();}
}
async function cleanup(){
 try{for(const entry of await fs.readdir(directory)){if(!/^\d+-(car-v2|browser|source|partial)\.mp4$/.test(entry))continue;const file=new URL(entry,directory);const stat=await fs.stat(file);if(Date.now()-stat.mtimeMs>3*3600000)await fs.rm(file,{force:true});}}catch{}
}
async function convert(id,media){
 if(!/^\d{1,30}$/.test(id)||!Number.isSafeInteger(media.total)||media.total<=0||media.total>200*1024*1024)throw Error('视频大小超出处理限制');
 const cached=await cachedBrowserMedia(id);if(cached)return cached;
 await fs.mkdir(directory,{recursive:true});await cleanup();
 const input=new URL(id+'-source.mp4',directory),partial=new URL(id+'-partial.mp4',directory),output=new URL(id+suffix,directory);
 try{
  await download(media,input);
  await exec(process.env.HGTV_FFMPEG,['-hide_banner','-loglevel','error','-y','-i',fileURLToPath(input),'-map','0:v:0','-map','0:a:0?','-c:v','libx264','-vf',"scale=w='min(540,iw)':h=-2",'-r','30','-preset','veryfast','-crf','26','-profile:v','baseline','-level:v','3.1','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-profile:a','aac_low','-b:a','96k','-ac','2','-ar','44100','-movflags','+faststart',fileURLToPath(partial)],{timeout:180000,windowsHide:true,maxBuffer:1024*1024});
  await fs.rename(partial,output);
  return fileMedia(output,(await fs.stat(output)).size);
 }catch{throw Error('本集准备失败，请重试');}
 finally{await Promise.allSettled([fs.rm(input,{force:true}),fs.rm(partial,{force:true})]);}
}
