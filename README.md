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

当前电脑已有设备状态 `.device.json`，不需要连接手机。全新部署仍需有效设备状态；平台注册接口目前可能返回零编号，不能保证新环境自动初始化成功。已有状态失效后也可能需要重新初始化，这是剩余限制。不要把个人设备状态公开提交。

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
