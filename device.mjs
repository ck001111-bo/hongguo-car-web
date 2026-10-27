import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import axios from 'axios';

const file=new URL('./.device.json',import.meta.url);
const salt=Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58','hex');
const sha=b=>crypto.createHash('sha512').update(b).digest();
export const userAgent='com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)';
let pending;
export function parseRegistrationResponse(raw){
 const data=typeof raw==='string'?JSON.parse(raw.replace(/("(?:device_id|install_id)"\s*:\s*)(\d+)/g,'$1"$2"')):raw;
 const device_id=String(data.device_id_str||data.device_id||''),iid=String(data.install_id_str||data.install_id||'');
 if(!/^[1-9]\d+$/.test(device_id)||!/^[1-9]\d+$/.test(iid)){
  const error=new Error('设备初始化未成功，暂不能连接 App 片源');error.code='DEVICE_REGISTRATION_REJECTED';throw error;
 }
 return {device_id,iid};
}
export async function getDevice(){
 if(pending)return pending;
 pending=load().catch(e=>{pending=null;throw e;});return pending;
}
async function load(){
 try{const d=JSON.parse(await fs.readFile(file,'utf8'));if(/^[1-9]\d+$/.test(d.device_id)&&/^[1-9]\d+$/.test(d.iid))return d;}catch{}
 const now=Date.now();const cdid=crypto.randomUUID(),openudid=crypto.randomBytes(8).toString('hex');
 const values={ac:'wifi',aid:'8662',app_name:'novelread',channel:'update_64',device_brand:'Redmi',device_platform:'android',device_type:'25053RT47C',dpi:'520',language:'zh',manifest_version_code:'73532',os:'android',os_api:'36',os_version:'16',resolution:'1280*2772',ssmix:'a',update_version_code:'73532',version_code:'73532',version_name:'7.3.5.32',cdid,openudid,tt_data:'a',package:'com.phoenix.read',ts:String(Math.floor(now/1000)),_rticket:String(now)};
 const header={display_name:'红果免费短剧',update_version_code:73532,manifest_version_code:73532,app_version_minor:'',aid:8662,channel:'update_64',package:'com.phoenix.read',app_version:'7.3.5.32',version_code:73532,sdk_version:'3.7.2',sdk_target_version:29,os:'Android',os_version:'16',os_api:36,device_model:'25053RT47C',device_brand:'Redmi',device_manufacturer:'Xiaomi',cpu_abi:'arm64-v8a',density_dpi:520,display_density:'xxhdpi',resolution:'1280x2772',language:'zh',timezone:8,access:'wifi',not_request_sender:0,cdid,openudid,clientudid:crypto.randomUUID(),ipv6_list:[],region:'CN',tz_name:'Asia/Shanghai',tz_offset:28800,sim_region:'cn',sim_serial_number:[],oaid_may_support:1,req_id:crypto.randomUUID(),device_platform:'android',custom:{account_region_src:'fallback',host_bit:64,account_region:'cn',dragon_device_type:'phone',is_android_fold:0,filter_warn:0,web_ua:'',is_android_pad:0},pre_installed_channel:'',apk_first_install_time:now,is_system_app:0,sdk_flavor:'china',guest_mode:0};
 const compressed=zlib.gzipSync(Buffer.from(JSON.stringify({magic_tag:'ss_app_log',header,_gen_time:now})));
 const seed=crypto.randomBytes(32),derived=sha(Buffer.concat([sha(seed),salt]));
 const cipher=crypto.createCipheriv('aes-128-cbc',derived.subarray(0,16),derived.subarray(16,32));
 const encoded=Buffer.concat([Buffer.from([116,99,5,16,0,0]),seed,cipher.update(Buffer.concat([sha(compressed),compressed])),cipher.final()]);
 const response=await axios.post('https://log.snssdk.com/service/2/device_register/?'+new URLSearchParams(values),encoded,{timeout:20000,maxContentLength:1024*1024,responseType:'text',transformResponse:[x=>x],headers:{'User-Agent':userAgent,'Content-Type':'application/octet-stream;tt-data=a','Content-Encoding':'gzip','log-encode-type':'gzip','X-Tt-Request-Tag':'t=0;n=1','x-ss-dp':'8662','x-ss-req-ticket':String(now),'x-vc-bdturing-sdk-version':'4.0.3.cn',lc:'102','sdk-version':'2','passport-sdk-version':'60755','passport-sdk-settings':'device_transfer_s_0,device_transfer_ab_1','x-tt-store-region':'cn','x-tt-store-region-src':'did','x-neptune':'-8|50:51:59:30:40:47:49:39','x-ss-stub':crypto.createHash('md5').update(encoded).digest('hex').toUpperCase()}});
 const {device_id,iid}=parseRegistrationResponse(response.data);
 const cookies=(response.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');
 const result={...values,device_id,iid,cookies};delete result.ts;delete result._rticket;delete result.tt_data;delete result.package;
 await fs.writeFile(file,JSON.stringify(result));return result;
}
