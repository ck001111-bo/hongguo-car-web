import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 隔离：测试写入的文件指向系统临时目录，避免触碰源码目录下的 .device.json。
process.env.HGTV_DEVICE_FILE = path.join(os.tmpdir(), `hg-auth-test-${process.pid}.json`);
process.env.HGTV_REGISTER_BACKOFF_MS = '0';
process.env.HGTV_REGISTER_ATTEMPTS = '1';

const devicePath = process.env.HGTV_DEVICE_FILE;
const clearDevice = () => { try { fs.rmSync(devicePath); } catch {} };

let device;
async function loadDevice() {
  if (!device) device = await import('../device.mjs');
  return device;
}

const OK = { device_id: '1905892595378490', install_id: '1905892595382586' };
const okPost = async () => ({ data: JSON.stringify(OK), headers: { 'set-cookie': ['sessionid=abc; Path=/'] } });
const transportPost = async () => { throw new Error('ECONNRESET'); };
const rejectPost = async () => { const e = new Error('rejected'); e.code = 'DEVICE_REGISTRATION_REJECTED'; throw e; };
const fallbackPost = async (endpoint) => {
  if (String(endpoint).includes('log.snssdk')) throw new Error('504');
  return okPost();
};

test('isRegisteredDevice 精确识别有效与无效设备', async () => {
  const {isRegisteredDevice} = await loadDevice();
  assert.equal(isRegisteredDevice({device_id:'1905892595378490', iid:'1905892595382586'}), true);
  assert.equal(isRegisteredDevice({device_id:'0', iid:'0'}), false);
  assert.equal(isRegisteredDevice(null), false);
  assert.equal(isRegisteredDevice({device_id:'123'}), false);
});

test('deviceFromEnv 在提供编号时返回设备，否则返回 null', async () => {
  const {deviceFromEnv} = await loadDevice();
  const prevId = process.env.HGTV_DEVICE_ID, prevIid = process.env.HGTV_INSTALL_ID;
  delete process.env.HGTV_DEVICE_ID; delete process.env.HGTV_INSTALL_ID;
  assert.equal(deviceFromEnv(), null);
  process.env.HGTV_DEVICE_ID = '1905892595378490';
  process.env.HGTV_INSTALL_ID = '1905892595382586';
  const injected = deviceFromEnv();
  assert.equal(injected.device_id, '1905892595378490');
  assert.equal(injected.iid, '1905892595382586');
  assert.ok(!('ts' in injected) && !('package' in injected));
  process.env.HGTV_DEVICE_ID = prevId; process.env.HGTV_INSTALL_ID = prevIid;
});

test('registerDevice 在首个入口成功并写入设备文件', async () => {
  const {registerDevice, storedDeviceStatus} = await loadDevice();
  clearDevice();
  const result = await registerDevice(okPost);
  assert.equal(result.device_id, OK.device_id);
  assert.equal(result.iid, OK.install_id);
  assert.equal(storedDeviceStatus(), 'registered');
  clearDevice();
});

test('registerDevice 首个入口传输失败回退到备用入口', async () => {
  const {registerDevice} = await loadDevice();
  clearDevice();
  const result = await registerDevice(fallbackPost);
  assert.equal(result.device_id, OK.device_id);
  assert.equal(result.iid, OK.install_id);
  clearDevice();
});

test('registerDevice 平台拒发编号直接抛出 REJECTED，不盲目重试', async () => {
  const {registerDevice} = await loadDevice();
  clearDevice();
  await assert.rejects(registerDevice(rejectPost), {code: 'DEVICE_REGISTRATION_REJECTED'});
  clearDevice();
});

test('registerDevice 所有入口传输失败抛出 TRANSPORT', async () => {
  const {registerDevice} = await loadDevice();
  clearDevice();
  await assert.rejects(registerDevice(transportPost), {code: 'DEVICE_REGISTRATION_TRANSPORT'});
  clearDevice();
});
