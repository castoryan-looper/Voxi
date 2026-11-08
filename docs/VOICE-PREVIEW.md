# 音色选择与一句话试听

管理员在 `/admin/ai/voice` 选择服务默认音色；普通用户在 `/app/profile` 的“我的语音音色”选择个人音色，或跟随服务默认。个人设置优先，同一用户的设备共用；FAST 回答和 Agent 语音播报均使用此音色。OpenClaw 自己的角色、模型和技能不因选音色而改变。

操作顺序：选择音色 → 点“试听这句话” → 收听 → 喜欢后单独保存。管理员使用页面下方“保存 AI 配置”，普通用户点“保存我的音色”。试听不保存设置，不录制麦克风，不加载个人记忆，也不创建 Agent 任务。

固定句子是：“你好，我是 Voxi。今天也很高兴和你一起，把事情做好。”页面标明 AI 合成声音。可停止试听；换音色、切换页面或退出会停止播放并释放临时音频。若浏览器阻止自动播放，点击音频控件播放。试听失败显示错误，不提供伪造的示例声音或偷偷切回另一音色。

## 与设备保持一致

现有语音后端是 Codex CLI 0.163.0、Realtime v3、WebRTC 和原有 Codex 登录。音色目录取自该版本 `RealtimeVoicesList::builtin().v3`，包含25个候选，默认继续使用 Cove；不会把另一协议的声音混入。目录说明兼容性，不代替账户可用性验收。

试听创建独立临时 `VoiceSession`，使用所选音色、同一模型/协议和 `thread/realtime/appendSpeech`，将实际收到的24kHz单声道 PCM 封装为 WAV 送给浏览器。无需额外 API Key。网页和 MiniCam 的网络压缩、扬声器、具体文本与说话方式会影响实际听感。

音色同时写入 `thread/realtime/start.voice` 和 Frameless `session.update.audio.output.voice`，避免被固定 Cove 覆盖。保存后设备重连或切换频道生效，不打断当前故事；音色选择本身不要求开启 Agent 频道服务。用户 FAST 文字偏好和个人音色分别保存，旧客户端保存文字偏好不会清掉音色。

旧语音配置自动补入 Cove；旧用户偏好自动补入“跟随服务默认”，保留原有资料。旧客户端保存无 voice 字段的语音配置也保留当前默认音色。没有固件、4G 码率、缓冲或额度修改。

保存过新版配置后，回退旧 Pocket 镜像需同时恢复升级前的语音配置备份；旧版校验器不认识新增的 voice 字段。不要只回退镜像并假定配置可向后读取。

## 资源与权限

试听仅限登录后的 `/api/admin/voice-preview` 或 `/api/user/voice-preview`，继承各自的 Cookie、CSRF、Origin 和用户身份控制，代理固定的 Docker 内网 `/voxi/voice-preview`。普通客户端不能指定别人的身份或自定义文本。内网接口仍需要内部 bearer，Pocket 公网 ingress 不开放此路径。

同时最多一个生成中的试听，并遵守现有语音会话名额；设备占满时拒绝试听，不关闭设备。语音最长12秒，整轮生成最长80秒；浏览器离开会取消上游会话。只缓存固定句子的近期最多4种音色，10分钟有效，不写音频文件。兼容目录由 `voxi_voices.py` 维护，升级 CLI 时需要重新核对。

`deploy/check-agent.sh` 应显示 `voicePreviewVersion: 1`，检查不调用语音模型。新增测试覆盖旧配置迁移、个人覆盖、音色传参、身份校验、限额/失败/取消回收，以及真实浏览器的音频解码、试听不自动保存、停止与页面切换。

本地浏览器验收使用模拟 PCM 音频，不能代替真实听感。尝试复用本机 Codex 登录时，Windows CLI 0.161.0 的 WebRTC 在等待确认时超时；因此真实音色仍需在升级后的云端网页试听验收。WebSocket 入口要求独立 API 认证，已舍弃该方案，最终只沿用当前云端设备已运行的 WebRTC 登录路径。

参考：[固定版本 Codex 音色和协议源码](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/protocol/src/protocol.rs)、[OpenAI 语音连接说明](https://developers.openai.com/api/docs/guides/voice-websockets)。
