# 最新开发交接

当前：[2026-11-08 · Voxi Agent 改造](2026-11-08-agent.md)。

当前优先沿用 codex-pocket-cloud 的现有登录与语音框架，实现频道路由、独立后台任务和管理员配置。模型 API 密钥暂不启用。代码、模拟验收、服务器部署、实机验收分别核对，不能混为完成。

已收到 8797dac 服务器检查成功输出：OpenClaw 接入能力可见，enabled=false、connections=0、channelOverrides=0；尚未启用新路由或接入真实 OpenClaw。

新增 [用户空间与角色权限](../USER-ACCOUNTS.md)：`/admin/users` 管理普通账户，`/app` 只管理绑定档案的资料、偏好、频道、连接、设备和任务。服务关闭可先保存设置；新增管理员开启服务/单独编辑频道的直接按钮。双用户真实浏览器+真实连接器+模拟 OpenClaw 全流程通过，部署后检查 userPortalVersion=1。托管 Codex 仍是试用环境，未完成公众多租户执行隔离。

4G 最新证据：[2026-11-08](2026-11-08.md)；历史基础：[2026-11-07](2026-11-07.md)。三分钟连续播放稳定性仍未达标，本次功能改造未调整传输参数。

最新新增 [音色与一句话试听](../VOICE-PREVIEW.md)：默认Cove兼容迁移，Codex0.163 v3目录25候选；管理员默认/普通用户个人覆盖；固定文本、实际WebRTC/appendSpeech音频封装WAV，试听不保存、不接个人记忆或Agent任务，限额/取消/缓存/身份校验已实现。浏览器验收使用模拟PCM；本机0.161真实登录验证WebRTC等待ACK超时。最终未用需要独立API认证的WebSocket，真实听感需云端升级后验收，检查voicePreviewVersion=1。
