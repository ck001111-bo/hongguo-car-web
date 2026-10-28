import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium,firefox,webkit} from 'playwright';
import {createApp} from '../server.mjs';
import {provider} from '../provider.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const destination=path.resolve(process.argv[2]||path.join(root,'.runtime','validation'));
await fs.mkdir(destination,{recursive:true});
if(!process.env.HGTV_FFMPEG){try{process.env.HGTV_FFMPEG=JSON.parse(await fs.readFile(path.join(root,'.local-runtime.json'),'utf8')).ffmpeg;}catch{}}
const password=process.env.HGTV_TEST_PASSWORD||crypto.randomBytes(24).toString('hex');
// Use one real catalog/detail snapshot so engine comparisons do not depend on repeated SSR requests.
const catalog=await provider.home(1),series=await provider.detail(catalog.items[0].id);
const selected=Number(process.env.HGTV_TEST_EPISODE||20)-1;
if(!series.episodes[selected])throw Error('验证片单没有第 20 集');
const source={...provider,home:async()=>catalog,detail:async id=>id===series.id?series:provider.detail(id)};
const server=createApp({source,password});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const serverMediaRequests=[];server.on('request',(req,res)=>{if(req.url.startsWith('/media/'))res.on('finish',()=>serverMediaRequests.push({status:res.statusCode,range:req.headers.range,cookiePresent:!!req.headers.cookie,origin:req.headers.origin}));});
const base=process.env.HGTV_TEST_BASE_URL||('http://127.0.0.1:'+server.address().port);
const report={at:new Date().toISOString(),series:series.title,episode:selected+1,phoneUsed:false,realCarTested:false,catalogSource:'one live SSR snapshot',results:[]};
const variants=[['Edge',chromium,{channel:'msedge'}],['Firefox',firefox,{}],['WebKit',webkit,{}]];
try{
 for(const [name,engine,options] of variants.filter(v=>!process.env.HGTV_TEST_BROWSERS||process.env.HGTV_TEST_BROWSERS.split(',').includes(v[0]))){
  const result={browser:name,checks:[],pageErrors:[],mediaRequests:[],consoleErrors:[]};let browser,page;
  try{
   browser=await engine.launch({headless:true,...options});const context=await browser.newContext({viewport:{width:1920,height:1080},hasTouch:true});page=await context.newPage();page.on('console',message=>{if(['error','warning'].includes(message.type()))result.consoleErrors.push(message.text().replace(/\/media\/[a-f0-9]+/g,'/media/<redacted>').slice(0,500));});page.on('pageerror',error=>result.pageErrors.push(error.message));page.on('response',response=>{if(response.url().includes('/media/')){const request=response.request();result.mediaRequests.push({status:response.status(),method:request.method(),range:request.headers().range,origin:request.headers().origin,contentType:response.headers()['content-type'],contentRange:response.headers()['content-range']});}});
   await page.goto(base);if(!await page.locator('#password').count()){await page.getByRole('button',{name:/Continue|继续/i}).first().click();await page.locator('#password').waitFor({timeout:30000});}await page.locator('#password').fill(password);await page.locator('#login-form button').click();await page.locator('#cards .card').first().waitFor({timeout:45000});result.checks.push({name:'UI login and real catalog',passed:true,count:await page.locator('.card').count()});
   await page.evaluate(item=>localStorage.setItem('hg-history',JSON.stringify([item])),{id:series.id,title:series.title,cover:series.cover,episode:selected,position:0});
   if(!await page.locator('body').evaluate(el=>el.classList.contains('car-mode')))await page.locator('#car-mode').click();
   await page.locator('#query').fill(series.title.slice(0,4));await page.locator('#search-form button').click();await page.locator('#cards .card').first().waitFor({timeout:45000});
   result.checks.push({name:'search or declared loaded-catalog fallback',passed:await page.locator('.card').count()>0});
   await page.locator('#video').evaluate(v=>{window.__playEvents=[];v.addEventListener('playing',()=>window.__playEvents.push({at:Date.now(),title:document.querySelector('#player-title').textContent}));v.addEventListener('ended',()=>window.__endedAt=Date.now());});const playbackStartedAt=Date.now();await page.locator('#cards .card').filter({hasText:series.title}).first().click();await page.locator('#episodes button').nth(selected).waitFor({timeout:45000});
   await page.locator('#video').evaluate(v=>{v.muted=true;});await page.waitForFunction(()=>!!document.querySelector('#video').getAttribute('src'),null,{timeout:Number(process.env.HGTV_DECODE_TIMEOUT_MS)||180000});if(await page.locator('#video').evaluate(v=>v.paused))await page.locator('#toggle-play').click();
   await page.waitForFunction(()=>{const v=document.querySelector('#video');return v.currentTime>2&&v.videoWidth>0&&!v.error;},null,{timeout:Number(process.env.HGTV_DECODE_TIMEOUT_MS)||180000});
   const sample=()=>page.locator('#video').evaluate(v=>({duration:v.duration,time:v.currentTime,width:v.videoWidth,height:v.videoHeight,frames:v.getVideoPlaybackQuality?.().totalVideoFrames??v.webkitDecodedFrameCount,error:v.error?.message||null}));
   const initial=await sample();result.firstVideoMs=Date.now()-playbackStartedAt;result.firstPlayingMs=await page.evaluate(t=>(window.__playEvents[0]?.at||Date.now())-t,playbackStartedAt);result.videoSample=initial;if(initial.error||!initial.width)throw Error('视频未解码');result.checks.push({name:'real episode video decode',passed:true,...initial});
   const seekTo=Math.min(30,initial.duration/2);await page.locator('#video').evaluate((v,t)=>v.currentTime=t,seekTo);await page.waitForFunction(t=>{const v=document.querySelector('#video');return v.currentTime>t+2&&v.readyState>=2;},seekTo,{timeout:45000});result.checks.push({name:'seek and continue',passed:true,...await sample()});
   for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:1024,height:600},{width:390,height:844}]){
    await page.setViewportSize(viewport);const layout=await page.evaluate(()=>({pageOverflow:document.documentElement.scrollWidth>innerWidth,dialogOverflow:document.querySelector('dialog').scrollWidth>document.querySelector('dialog').clientWidth+1,smallEpisodeButton:[...document.querySelectorAll('#episodes button')].some(b=>b.getBoundingClientRect().height<48)}));
    result.checks.push({name:`touch layout ${viewport.width}x${viewport.height}`,passed:!layout.pageOverflow&&!layout.dialogOverflow&&!layout.smallEpisodeButton,...layout});
   }
   await page.setViewportSize({width:1280,height:720});await page.screenshot({path:path.join(destination,name+'-car.png')});
   if(name==='Edge'){
    await page.evaluate(n=>window.__testNext=n,selected+2);
    const autoplay=page.locator('#autoplay');if(!await autoplay.isChecked())await autoplay.check();
    await page.locator('#video').evaluate(v=>v.currentTime=v.duration-0.3);
    await page.waitForFunction(()=>document.querySelector('#player-title').textContent.includes('第 '+(window.__testNext||21)+' 集'),null,{timeout:30000});
    await page.waitForFunction(()=>{const v=document.querySelector('#video');return v.currentTime>2&&v.videoWidth>0&&!v.error;},null,{timeout:Number(process.env.HGTV_DECODE_TIMEOUT_MS)||180000});const next=await sample();result.autoNextGapMs=await page.evaluate(()=>{const event=window.__playEvents.find(e=>e.at>=window.__endedAt);return event?event.at-window.__endedAt:null;});if(next.error||!next.width)throw Error('自动下一集失败');result.checks.push({name:'ended event and automatic next real episode',passed:true,...next});
   }
   await page.locator('#close-player').click();await page.locator('#history').click();await page.locator('.card').first().waitFor();result.checks.push({name:'local watch history',passed:true});
   await page.locator('#logout').click();await page.locator('#password').waitFor();const protectedResponse=await page.request.get(base+'/api/home');result.checks.push({name:'logout revokes session',passed:protectedResponse.status()===401});
   result.passed=result.checks.every(x=>x.passed)&&result.pageErrors.length===0;
  }catch(error){result.passed=false;result.error=error.message;if(page)try{result.lastVideoState=await page.locator('#video').evaluate(v=>({duration:v.duration,time:v.currentTime,width:v.videoWidth,ready:v.readyState,network:v.networkState,paused:v.paused,sourcePresent:!!v.getAttribute('src'),errorCode:v.error?.code,error:v.error?.message,status:document.querySelector('#play-status').textContent}));}catch{}}
  finally{if(browser)await browser.close();result.serverMediaRequests=serverMediaRequests.splice(0);report.results.push(result);await fs.writeFile(path.join(destination,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(result));}
 }
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
if(report.results.some(x=>!x.passed))process.exitCode=1;
