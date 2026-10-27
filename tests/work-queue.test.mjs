import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLimiter} from '../work-queue.mjs';
test('转码排队限制并发，失败任务不阻塞后续分集',async()=>{
 const limit=createLimiter(1),order=[];let release,active=0,peak=0;
 const first=limit(async()=>{active++;peak=Math.max(peak,active);order.push(1);await new Promise(r=>release=r);active--;throw Error('conversion failed');});
 const second=limit(async()=>{active++;peak=Math.max(peak,active);order.push(2);active--;return 'ready';});
 await Promise.resolve();assert.deepEqual(order,[1]);release();await assert.rejects(first,/conversion failed/);assert.equal(await second,'ready');assert.equal(peak,1);assert.deepEqual(order,[1,2]);
});
