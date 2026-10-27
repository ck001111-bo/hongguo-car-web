import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {playbackPayload} from '../playback-request.mjs';
test('播放正文与 HGTV 1.2.6 成功请求的实际校验值一致',()=>{
 const payload=playbackPayload('7694655426163379225');
 assert.equal(crypto.createHash('md5').update(payload).digest('hex').toUpperCase(),'F6FA77B20E6ECE42751CB4778750130E');
 const wrong=payload.replaceAll('false','0').replaceAll('true','1');
 assert.notEqual(crypto.createHash('md5').update(wrong).digest('hex').toUpperCase(),'F6FA77B20E6ECE42751CB4778750130E');
});
