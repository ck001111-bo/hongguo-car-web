# 红果车载浏览器客户端

面向乐道 L80 等无法安装第三方安卓 App 的车载娱乐屏。电脑后台获取片源，车机通过互联网浏览器选剧、选集和播放，不需要手机持续连接。

## 实测状态

- 独立 Node.js 后台已获取未缓存的第 12 集并完成 H.264/AAC 转码，没有调用手机。临时手机诊断工具已卸载，生产代码已移除 ADB 取址依赖。
- 第 11 集曾通过微软公网 Edge 验证：约 62.6 秒、720×1280 画面，拖到 30 秒后继续播放。
- 优化后第 20 集（105.4 秒）首次独立准备约 46 秒，输出 540×960 H.264 Baseline / AAC LC。第 12 集旧方案约 97 秒，两次片长不同，不能当作严格性能对比。首次等待取决于网络及服务器负载。
- 本机缓存分段请求 24 次、并发 4：中位 23ms，P95 31ms，内存增量约 13MiB；不代表车机公网速度。
- 浏览器验证覆盖 Edge（Chromium）、Firefox、WebKit，实际完整视频、拖动、自动下一集及四种屏幕布局；报告明确区分模拟浏览器与真实车机。
- 登录、会话、同源校验、视频分段传输和设备初始化恢复通过自动测试。
- 尚未在真实乐道 L80 车机验收。车机需要能访问网站，并支持 H.264/AAC MP4。不能保证所有剧集或浏览器可用。

## 运行

需要 Node.js 22+，以及支持 libx264/AAC 的 FFmpeg。

```powershell
npm ci --ignore-scripts
$env:HGTV_FFMPEG = 'C:/tools/ffmpeg.exe'
npm start
```

打开 http://127.0.0.1:8790 。首次启动生成 `.private-config.json`，其中 password 是访问密码。通过 HTTPS 访问时设置 COOKIE_SECURE=1。

Windows 可在 `.local-runtime.json` 保存 `{ "ffmpeg": "C:/tools/ffmpeg.exe" }`，启动脚本会加载。该文件不提交 Git。

当前电脑已有设备状态 `.device.json`，不需要连接手机。平台注册接口由多个前端域名提供，本程序依次尝试 `log`/`is`/`api-snssdk` 等入口并在传输失败时回退，单个入口抖动不再直接导致授权失败。若所有入口都返回零编号（平台限流或风控），会明确提示“片源连接未完成”，不会盲重试。已有状态失效后删除 `.device.json` 重新播放即可触发重新授权。不要把个人设备状态公开提交。

## 片源授权与设备注册

“片源授权”指设备向平台注册、取得有效 `device_id`/`install_id`，随后签名请求才能拉到可播放的视频源。本程序把这一环节做厚：

- **多入口容灾**：默认依次尝试多个注册域名，任一可用即完成授权。
- **预置已注册设备**：全新部署或注册被拦截时，可直接用已有的有效编号跳过网络注册：

```powershell
$env:HGTV_DEVICE_ID = '1905892595378490'     # 有效 device_id（纯数字，首位非 0）
$env:HGTV_INSTALL_ID = '1905892595382586'    # 有效 install_id
$env:HGTV_DEVICE_COOKIES = ''                # 可选，原注册响应里的会话 Cookie
npm start
```

也可把一份完整的设备 JSON 通过 `HGTV_DEVICE_JSON` 指向文件路径注入。

- **状态可见**：`/health` 新增 `device` 字段（`registered`/`missing`/`invalid`），登录后 `/api/device/status` 返回同样的授权状态，便于在车机端确认片源授权是否就绪。
- **错误分流**：网络/超时归为 `DEVICE_REGISTRATION_TRANSPORT`（提示检查网络或代理），平台拒发编号归为 `DEVICE_REGISTRATION_REJECTED`（提示等待修复），不再混为一谈。

相关环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HGTV_DEVICE_ID` / `HGTV_INSTALL_ID` | 无 | 注入已注册设备编号，跳过网络注册 |
| `HGTV_DEVICE_COOKIES` | 无 | 注入设备时附带的会话 Cookie |
| `HGTV_DEVICE_JSON` | 无 | 指向完整设备 JSON 文件，注入设备状态 |
| `HGTV_DEVICE_FILE` | `./.device.json` | 本机设备状态的保存路径（也用于测试隔离） |
| `HGTV_REGISTER_ENDPOINTS` | 多个 snssdk 域名 | 逗号分隔，覆盖默认注册入口 |
| `HGTV_REGISTER_ATTEMPTS` | `2` | 单个入口的传输层重试次数 |
| `HGTV_REGISTER_BACKOFF_MS` | `1000` | 重试之间的退避毫秒数 |

恢复授权：删除 `.device.json`（或 `HGTV_DEVICE_FILE` 指向的文件），下一次播放会重新向平台注册。

## 外网与车机

运行 `启动微软公网访问.ps1`。电脑必须保持开机并联网。微软 Dev Tunnels 提供转发入口，不代替服务器托管。

`bin/devtunnel.exe` 不提交仓库。请从微软官方 Dev Tunnels 安装说明获取，放入 bin，保留有效 Microsoft Corporation 数字签名；脚本会验证。首次使用需本人登录微软账号，网站另有密码保护。

登录后点击“大屏模式”，可使用横屏布局、大触控按钮、分集列表、上一集/下一集和全屏入口。浏览器限制自动播放时，手动点击视频播放按钮。观看记录只保存在当前浏览器。

新集数首次准备需要下载和转码；缓存后可直接播放。缓存位于 `.runtime/`，不上传 GitHub。Dockerfile 已包含 FFmpeg；容器部署仍需有效设备状态和 HTTPS 入口。GitHub Actions 配置覆盖 Windows/Linux、Node 22/24 及容器启动。

## 测试与文件

```powershell
npm test
npm run test:browser
npm run test:performance -- 7694655342478642201
```

传输测试使用合成数据，不替代真实片源和车机播放测试。

- `server.mjs`：登录、权限、页面和视频 Range 传输。
- `provider.mjs`：片单、播放请求、签名适配和清晰度选择。
- `device.mjs`、`device-state.mjs`：设备状态与初始化恢复。
- `transcode.mjs`：H.264/AAC 转码、缓存和媒体读取。
- `public/`：网页和横屏触控界面。
- `vendor/`：固定版本上游代码与许可信息。

## 私密信息与许可

密码、设备状态、会话、隧道配置和视频缓存排除在 Git 及源码压缩包之外。代码按 GPL-3.0-only 提供，来源见 NOTICE.md 和 vendor/。不分发原 HGTV APK，不发布平台视频。本项目与红果官方无关联，非官方接口可能变化。
