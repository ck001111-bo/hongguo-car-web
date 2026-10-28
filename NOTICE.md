# 来源与许可证

本网页客户端及服务端适配代码以 GPL-3.0-only 提供。源码随本目录完整交付，许可证见 LICENSE。

provider.mjs 初始派生自 N3urda/hongguoTV 的 server/provider.mjs（GPL-3.0），本版添加浏览器适配与请求边界。

vendor/hongguo.cjs 来自同仓库引用的 drpys 固定提交 22261adfa31435e3b3ef5a730b8a2a75bcaf1715，保持原始来源与 GPL 许可证；详情见 vendor/NOTICE.upstream.md 和 vendor/LICENSE.drpys。兼容性变更集中在 provider.mjs，不更改原始 vendor 文件。

HGTV 1.2.2.1 和 1.2.6 APK 的静态分析用于核对其设备注册、接口备用和原生播放流程；该 APK 关于页声明派生自 N3urda/hongguoTV，并指向 pan8664716/HGTV。APK 不在本程序中分发。

本项目与红果官方无关联，不保证平台非官方接口持续可用。


浏览器 HLS 播放使用 hls.js 1.6.16（Apache-2.0），分发文件 public/hls.min.js，许可证 vendor/LICENSE.hls.js。
