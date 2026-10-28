import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import axios from 'axios';
import {pathToFileURL} from 'node:url';

const file = process.env.HGTV_DEVICE_FILE
  ? pathToFileURL(path.resolve(process.env.HGTV_DEVICE_FILE))
  : new URL('./.device.json', import.meta.url);
const salt = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');
const sha = b => crypto.createHash('sha512').update(b).digest();
export const userAgent = 'com.phoenix.read/73532 (Linux; U; Android 16; zh_CN; 25053RT47C; Build/BP2A.250605.031.A3)';

// 片源授权（设备注册）入口：平台同一后端由多个前端域名提供，任一可用即可完成授权。
// 默认顺序按可用性从高到低；可用 HGTV_REGISTER_ENDPOINTS 覆盖（逗号分隔）。
const REGISTRATION_ENDPOINTS = (process.env.HGTV_REGISTER_ENDPOINTS
  ? String(process.env.HGTV_REGISTER_ENDPOINTS).split(',').map(s => s.trim()).filter(Boolean)
  : [
      'https://log.snssdk.com/service/2/device_register/',
      'https://is.snssdk.com/service/2/device_register/',
      'https://api-snssdk.com/service/2/device_register/',
    ]);
// 单个入口的传输层重试次数与退避（仅对网络/超时错误重试，不对平台拒发编号重试）。
const REGISTRATION_ATTEMPTS = Math.max(1, Number(process.env.HGTV_REGISTER_ATTEMPTS || 2));
const REGISTRATION_BACKOFF_MS = Math.max(0, Number(process.env.HGTV_REGISTER_BACKOFF_MS || 1000));

let pending;

export function parseRegistrationResponse(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw.replace(/("(?:device_id|install_id)"\s*:\s*)(\d+)/g, '$1"$2"')) : raw;
  const device_id = String(data.device_id_str || data.device_id || '');
  const iid = String(data.install_id_str || data.install_id || '');
  if (!/^[1-9]\d+$/.test(device_id) || !/^[1-9]\d+$/.test(iid)) {
    const error = new Error('设备初始化未成功，暂不能连接 App 片源');
    error.code = 'DEVICE_REGISTRATION_REJECTED';
    throw error;
  }
  return { device_id, iid };
}

export function isRegisteredDevice(d) {
  return !!d && typeof d === 'object' && /^[1-9]\d+$/.test(String(d.device_id)) && /^[1-9]\d+$/.test(String(d.iid));
}

// 从环境变量注入已注册设备，避免全新部署或注册接口限流/被拦截时无法授权片源。
// 优先级：HGTV_DEVICE_ID + HGTV_INSTALL_ID 直接提供编号；或 HGTV_DEVICE_JSON 指向完整设备文件。
export function deviceFromEnv() {
  const id = process.env.HGTV_DEVICE_ID;
  const iid = process.env.HGTV_INSTALL_ID;
  if (id && iid && /^[1-9]\d+$/.test(String(id)) && /^[1-9]\d+$/.test(String(iid))) {
    const result = buildValues(Date.now());
    result.device_id = String(id);
    result.iid = String(iid);
    result.cookies = process.env.HGTV_DEVICE_COOKIES || '';
    delete result.ts;
    delete result._rticket;
    delete result.tt_data;
    delete result.package;
    return result;
  }
  const jsonPath = process.env.HGTV_DEVICE_JSON;
  if (jsonPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (isRegisteredDevice(parsed)) return parsed;
    } catch {
      /* 文件缺失或格式错误时回退到网络注册 */
    }
  }
  return null;
}

// 同步读取本地已保存的设备状态，仅用于状态展示（/health、/api/device/status），不触发网络。
export function storedDeviceStatus() {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isRegisteredDevice(data) ? 'registered' : 'invalid';
  } catch {
    return 'missing';
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildValues(now) {
  return {
    ac: 'wifi', aid: '8662', app_name: 'novelread', channel: 'update_64', device_brand: 'Redmi',
    device_platform: 'android', device_type: '25053RT47C', dpi: '520', language: 'zh',
    manifest_version_code: '73532', os: 'android', os_api: '36', os_version: '16',
    resolution: '1280*2772', ssmix: 'a', update_version_code: '73532', version_code: '73532',
    version_name: '7.3.5.32', cdid: crypto.randomUUID(), openudid: crypto.randomBytes(8).toString('hex'),
    tt_data: 'a', package: 'com.phoenix.read', ts: String(Math.floor(now / 1000)), _rticket: String(now),
  };
}

function buildHeader(now) {
  return {
    display_name: '红果免费短剧', update_version_code: 73532, manifest_version_code: 73532, app_version_minor: '',
    aid: 8662, channel: 'update_64', package: 'com.phoenix.read', app_version: '7.3.5.32', version_code: 73532,
    sdk_version: '3.7.2', sdk_target_version: 29, os: 'Android', os_version: '16', os_api: 36,
    device_model: '25053RT47C', device_brand: 'Redmi', device_manufacturer: 'Xiaomi', cpu_abi: 'arm64-v8a',
    density_dpi: 520, display_density: 'xxhdpi', resolution: '1280x2772', language: 'zh', timezone: 8,
    access: 'wifi', not_request_sender: 0, cdid: crypto.randomUUID(), openudid: crypto.randomBytes(8).toString('hex'),
    clientudid: crypto.randomUUID(), ipv6_list: [], region: 'CN', tz_name: 'Asia/Shanghai', tz_offset: 28800,
    sim_region: 'cn', sim_serial_number: [], oaid_may_support: 1, req_id: crypto.randomUUID(),
    device_platform: 'android', custom: {
      account_region_src: 'fallback', host_bit: 64, account_region: 'cn', dragon_device_type: 'phone',
      is_android_fold: 0, filter_warn: 0, web_ua: '', is_android_pad: 0,
    }, pre_installed_channel: '', apk_first_install_time: now, is_system_app: 0, sdk_flavor: 'china', guest_mode: 0,
  };
}

function buildBody(now, header) {
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify({ magic_tag: 'ss_app_log', header, _gen_time: now })));
  const seed = crypto.randomBytes(32);
  const derived = sha(Buffer.concat([sha(seed), salt]));
  const cipher = crypto.createCipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32));
  return Buffer.concat([
    Buffer.from([116, 99, 5, 16, 0, 0]), seed,
    cipher.update(Buffer.concat([sha(compressed), compressed])), cipher.final(),
  ]);
}

function registrationHeaders(now, encoded) {
  return {
    'User-Agent': userAgent,
    'Content-Type': 'application/octet-stream;tt-data=a',
    'Content-Encoding': 'gzip',
    'log-encode-type': 'gzip',
    'X-Tt-Request-Tag': 't=0;n=1',
    'x-ss-dp': '8662',
    'x-ss-req-ticket': String(now),
    'x-vc-bdturing-sdk-version': '4.0.3.cn',
    lc: '102',
    'sdk-version': '2',
    'passport-sdk-version': '60755',
    'passport-sdk-settings': 'device_transfer_s_0,device_transfer_ab_1',
    'x-tt-store-region': 'cn',
    'x-tt-store-region-src': 'did',
    'x-neptune': '-8|50:51:59:30:40:47:49:39',
    'x-ss-stub': crypto.createHash('md5').update(encoded).digest('hex').toUpperCase(),
  };
}

function normalizeCookies(headers = {}) {
  const raw = headers['set-cookie'] || headers['Set-Cookie'];
  if (Array.isArray(raw)) return raw.map(c => String(c).split(';')[0]).join('; ');
  if (typeof raw === 'string') return raw.split(';')[0];
  return '';
}

function finalizeDevice(values, device_id, iid, cookies) {
  const result = { ...values, device_id, iid, cookies };
  delete result.ts;
  delete result._rticket;
  delete result.tt_data;
  delete result.package;
  return result;
}

async function defaultPost(endpoint, values, encoded, now) {
  return axios.post(endpoint + '?' + new URLSearchParams(values), encoded, {
    timeout: 20000, maxContentLength: 1024 * 1024, responseType: 'text', transformResponse: [x => x],
    headers: registrationHeaders(now, encoded),
  });
}

// 片源授权核心：依次尝试多个注册入口，传输/超时错误重试并回退下一入口；
// 平台明确拒发编号（零编号）不再盲目重试，直接抛出 DEVICE_REGISTRATION_REJECTED。
// post 可注入以便测试；生产使用默认 axios 实现。
export async function registerDevice(post = defaultPost) {
  const now = Date.now();
  const values = buildValues(now);
  const encoded = buildBody(now, buildHeader(now));
  let lastTransport;
  for (const endpoint of REGISTRATION_ENDPOINTS) {
    for (let attempt = 0; attempt < REGISTRATION_ATTEMPTS; attempt += 1) {
      try {
        const response = await post(endpoint, values, encoded, now);
        const { device_id, iid } = parseRegistrationResponse(response.data);
        const result = finalizeDevice(values, device_id, iid, normalizeCookies(response.headers));
        await fsp.writeFile(file, JSON.stringify(result));
        return result;
      } catch (e) {
        if (e && e.code === 'DEVICE_REGISTRATION_REJECTED') throw e;
        lastTransport = e;
        if (attempt + 1 < REGISTRATION_ATTEMPTS) await delay(REGISTRATION_BACKOFF_MS);
      }
    }
  }
  const error = new Error('设备注册网络异常，片源授权未完成：' + (lastTransport?.message || '所有注册入口均不可用'));
  error.code = 'DEVICE_REGISTRATION_TRANSPORT';
  throw error;
}

export async function getDevice() {
  if (pending) return pending;
  pending = load().catch(e => {
    pending = null;
    throw e;
  });
  return pending;
}

async function load() {
  try {
    const existing = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (isRegisteredDevice(existing)) return existing;
  } catch {
    /* 没有本地设备状态，继续注册或注入 */
  }
  const injected = deviceFromEnv();
  if (injected) {
    await fsp.writeFile(file, JSON.stringify(injected));
    return injected;
  }
  return registerDevice();
}
