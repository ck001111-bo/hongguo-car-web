import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),base=new URL(process.argv[2]||'https://cdvxmjm3-8790.jpe1.devtunnels.ms'),output=path.resolve(process.argv[3]||path.join(root,'..'));
if(!['https:','http:'].includes(base.protocol))throw Error('需要HTTP地址');
let config;try{config=JSON.parse(await fs.readFile(path.join(root,'.player-config.json'),'utf8'));}catch{config={key:crypto.randomBytes(32).toString('hex')};await fs.writeFile(path.join(root,'.player-config.json'),JSON.stringify(config));}
const api=new URL('/player/api',base);api.searchParams.set('key',config.key);
const sites=[{key:'hongguo-local',name:'红果·独立电脑后台',type:1,api:api.href,searchable:1,quickSearch:1,filterable:0}];
await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'红果现有源-TVBox.json'),JSON.stringify({sites},null,2));
const alternates=JSON.parse(await fs.readFile(path.join(root,'sources.json'),'utf8'));
await fs.writeFile(path.join(output,'备用公开接口-TVBox.json'),JSON.stringify({sites:alternates.filter(s=>s.enabled).map(s=>({key:s.key,name:s.name,type:1,api:s.api,searchable:1,quickSearch:1,filterable:0}))},null,2));
await fs.writeFile(path.join(output,'现有源接口说明.json'),JSON.stringify({format:'MacCMS JSON VOD compatible subset',subscriptionUrl:new URL('/player/config?key='+config.key,base).href,api:api.href,requiresBackendOnline:true,requiresValidDeviceState:true,playbackUrlExpiresMinutes:30,credentials:'本文件包含独立播放器密钥，不要公开上传；不含网站密码或个人设备编号。',supported:['TVBox及支持type=1苹果CMS JSON接口的播放器；未在真实TVBox设备验证'],unsupported:['不支持JSON采集接口的播放器不能直接导入；VLC通常需直接播放链接或M3U'],search:{ac:'videolist',wd:'剧名'},detail:{ac:'detail',ids:'剧集编号'},play:{ac:'play',episode:'分集编号'},notes:['电脑与微软隧道必须在线','原始红果签名接口不是通用播放器源，导出的是当前独立后台适配接口','第三方目录、清单与实际解码状态分别验证；接口可能随时变化'],alternates},null,2));
console.log('已生成三个JSON配置；密钥仅保留本机交付文件。');
