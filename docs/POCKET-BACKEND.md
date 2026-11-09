# 复用已登录的 codex-pocket-cloud（不填 API Key）

Voxi 的 `MODE=pocket` 复用 [codex-pocket-cloud](https://github.com/castoryan-looper/codex-pocket-cloud) 容器里的官方 Codex 登录，新增独立的实时语音入口。ESP32 保留现有 Voxi 地址、设备令牌与根 CA，无需改成 Pocket 的设备协议或重刷固件。

```text
ESP32 → Voxi :9443 /radio → Docker 内部 Pocket /voxi
                         → 独立 Codex app-server → WebRTC 原生语音
```

## 已实现与限制

- 不读取、复制或导出 auth.json / 账号令牌，不把 ChatGPT 登录当作通用 OpenAI API Key。
- 通过官方 app-server 的 `thread/realtime/start` + WebRTC 协商使用现有登录。没有配置 API Key 时不会回退到收费 API 路径。
- Pocket 的设备令牌只用于内部服务间鉴权，由连接脚本写入 /etc/voxi/gateway.env，终端不显示它。ESP32 的 Voxi 设备令牌不变。
- 每路实时语音有独立、临时、只读的 app-server/WebRTC 会话，不使用 Pocket 原有任务会话。设备连接和语音席位分开。Pocket 容器内 `VOXI_MAX_SESSIONS` 可设 1–4（未设置时默认 2）。达到席位数后，其他设备仍可保持在线，按需回收一个空闲席位来响应。
- 沿用 Voxi 频道、PTT、滤波和打断。原生服务确认 Frameless Bidi 会话配置后设备显示 READY；按住时云端暂存音频，松开后提交，并用静音尾段触发服务端结束检测。
- Codex 0.163.0 固定版本源码中，直接 Realtime WebSocket 要求 API Key；本适配使用支持账号登录的 WebRTC 路线。
- 这是实验接口。账号必须有原生语音权限，并受账号实际额度与地区/服务可用性限制；登录成功不等于原生语音一定可用。真实延迟和音色需在此服务器验证。
- 增加 aiortc/WebRTC 依赖；不新增 Whisper/TTS 模型。依赖用独立 Docker 层安装，尽量复用原有 Whisper 层。首次重建仍需留出磁盘空间。

## 1. 先升级 Pocket Cloud

你当前容器名为 `codex-pocket-gateway-1`，且使用已有自动部署。可以在服务器管理终端立即触发检查：

```bash
sudo python3 /usr/local/lib/codex-pocket-autodeploy/autodeploy.py run --retry
```

等待构建与健康检查完成，再确认新模块和共享网络已安装：

```bash
docker exec --user 10001:10001 codex-pocket-gateway-1 codex --version
docker exec --user 10001:10001 codex-pocket-gateway-1 python -c 'import aiortc; from pathlib import Path; print("voice module:", Path("/app/bridge/voxi.py").is_file())'
docker network inspect codex-pocket-radio --format '{{.Name}}'
```

应看到 `voice module: True` 与 `codex-pocket-radio`。不要删除登录、工作区或模型卷。

如果没有上述自动部署程序，在原 Pocket Cloud 仓库目录执行 `git pull --ff-only` 和 `sudo bash deploy/docker.sh up`，沿用现有 `.env.docker`。此操作会重建 Pocket 的 gateway/ingress，短暂中断原任务连接，但保留登录和数据卷。

## 2. 将 Voxi 接到 Pocket

```bash
cd ~/Voxi
sudo systemctl stop voxi-update.timer
git -c core.hooksPath=/dev/null pull --ff-only
sudo bash deploy/connect-pocket.sh codex-pocket-gateway-1
sudo systemctl start voxi-update.timer
sudo curl --cacert /etc/voxi/tls/ca.crt https://43.160.215.253:9443/healthz
```

连接脚本先检查新 Pocket 网络和运行依赖，再通过 stdin 读取其设备 bearer；保持 Voxi 原 DEVICE_TOKEN 和 TLS 配置，只切换 MODE=pocket 并追加内部连接参数。它建立 `/etc/voxi/pocket.enabled` 标记，后续自动部署持续附加共享网络。

healthz 应显示 `mode=pocket`。这只验证进程，**真实语音可用性由设备连接时的原生会话握手验证**。

## 3. 使用和排查

ESP32 自动重连；管理页显示“云端就绪”后，按住 BOOT 说话，松开听回复。无需重新填写令牌/CA。切频道会启动新的语音会话，换台可能比 Realtime API 模式慢。

如果一直未就绪：

```bash
cd ~/Voxi
sudo docker compose --env-file /etc/voxi/deploy.env -f compose.yaml -f compose.pocket.yaml logs --tail=80 gateway
docker logs --tail=80 codex-pocket-gateway-1
```

原生会话失败可能是 CLI 版本、登录过期、账号无语音权限、会话配置不被接受或 WebRTC/UDP 出站受限。错误不会触发 API Key 回退，也不会修改既有登录。不要通过公开导出账号凭据来修复。

恢复模拟模式：将 /etc/voxi/gateway.env 中 MODE 改回 mock，然后 `sudo bash deploy/deploy.sh --force`；已有连接参数可以保留。

官方依据：[Codex app-server](https://learn.chatgpt.com/docs/app-server)、[0.163.0 实时传输实现](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/realtime_conversation.rs)、[0.163.0 参数协议](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server-protocol/src/protocol/v2/realtime.rs)。本轮模拟协议测试及本地 WebRTC SDP 测试不代替真实账号联调。


## 两台设备同时在线（2026-11-03）

设备在线与语音并发分别在「运营总览」中显示。会话启动前预留语音席位，断开或启动失败后释放。所有席位都在工作时，其他设备仍在线，可稍后重试录音。原生账号额度及服务器实际语音吞吐以实测为准。

同一家庭/测试网关下两台ESP32可使用现有Voxi设备令牌和CA；共享令牌不是每设备身份系统。每个WebSocket创建独立会话，频道与音频分别处理。诊断日志用sessionId区分Pocket语音统计。

更新Pocket Cloud后，在服务器~/Voxi拉取最新代码，运行：

```bash
sudo bash deploy/connect-pocket.sh codex-pocket-gateway-1
docker exec codex-pocket-gateway-1 printenv VOXI_MAX_SESSIONS
```

该脚本会保留 ESP32 使用的 DEVICE_TOKEN 和 CA，重新同步内部 Pocket 令牌，然后部署 Voxi。服务更新会短暂重连。验证时先检查各设备都 READY，再分别对话、切台和断开一台，观察其他设备是否继续在线。

测试：Voxi25项通过；Pocket test_voxi共17项，12项通过、5项可选原生依赖测试跳过。新增两路准入、第三路拒绝、频道隔离、断开释放槽位和存活会话继续使用的回归。
