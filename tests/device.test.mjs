import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRegistrationResponse} from '../device.mjs';
import {createInitializationCache} from '../device-state.mjs';
test('注册响应中的19位编号保持精确，零编号必须拒绝',()=>{
 assert.deepEqual(parseRegistrationResponse('{"device_id":1905892595378490123,"install_id":1905892595382586123}'),{device_id:'1905892595378490123',iid:'1905892595382586123'});
 assert.throws(()=>parseRegistrationResponse('{"device_id":0,"install_id":0}'),{code:'DEVICE_REGISTRATION_REJECTED'});
});
test('并发初始化合并请求，失败冷却后可恢复，不永久缓存失败',async()=>{
 let clock=0,requests=0;
 const get=createInitializationCache(async()=>{requests++;if(requests===1)throw Error('temporary upstream failure');return {device_id:'123',iid:'456'};},{clock:()=>clock,retryDelayMs:60_000});
 const first=await Promise.allSettled([get(),get(),get()]);assert.ok(first.every(r=>r.status==='rejected'));assert.equal(requests,1);
 clock=59_999;await assert.rejects(get());assert.equal(requests,1);
 clock=60_001;assert.deepEqual(await get(),{device_id:'123',iid:'456'});assert.equal(requests,2);
 await get();assert.equal(requests,2);
});
