# Voxi Agent / Pocket Cloud 首版

产品方向：频道由用户命名和绑定；提供现有 Pocket Cloud + Codex 的 Voxi Agent，以及自有 OpenClaw 的云端 HTTPS / 家中主动连接两种接入。不需要迁移已有 Codex 登录或填写模型 API Key。

## 管理入口

- `/admin/agent`：“频道与助手”。用“为谁配置”选择默认频道或某位用户，在同一个编辑器修改 CH0–CH3；在同页设置快问和 Voxi Agent 的默认行为。
- `/admin/ai/voice`：“语音与试听”。设置默认音色并试听，样音管理和技术参数可展开。
- 「用户账户 → 管理用户 → 后台任务」：为该用户派发任务，查看状态和结果，批准、拒绝、回答问题、停止或继续。
- `/admin/agent/credentials`：通过“助手运行参数”中的备用 API 密钥入口访问，当前执行器使用服务器的 Codex 登录。
- `/admin/users`：管理员开通、停用普通账户及重置密码；`/app` 为用户个人空间，见 [账户说明](USER-ACCOUNTS.md)。

沿用现有管理员用户名/密码、HttpOnly 会话及 CSRF 防护，不新增公网 Pocket 控制接口。设备 token 不能登录管理员页面。

## 频道与提示词

“助手怎么工作”中的快问使用默认回答方式，Voxi Agent 使用默认任务规则，自有 OpenClaw 使用其自身配置。旧的“提示词配置”链接会跳到这里。

默认频道供未单独设置的用户使用。选择某位用户时，可以直接编辑其生效频道；保存后只应用到该用户。“恢复默认频道”会清除个人覆盖。普通用户可在“我的频道”设置自己的频道和快问回答偏好。OpenClaw 连接按用户绑定。

## 接入已有 OpenClaw

选择用户并展开“此用户的 OpenClaw 连接”。Agent ID 默认 `main`；多个已有 Agent 可分别创建连接并绑定不同频道。

先在 OpenClaw 所在机器启用官方 Responses 接口：

```bash
openclaw config set gateway.http.endpoints.responses.enabled true
openclaw gateway restart
```

**家中电脑／内网（推荐）**：创建“主动连接”，下载页面提供的 `voxi-openclaw.py`，在 OpenClaw 电脑按页面生成的命令运行。需要 Python 3.10+，无需安装第三方 Python 包；按提示粘贴一次性显示的 Voxi 连接密钥与本机 Gateway Token／密码。连接器只向 Voxi HTTPS 主动发请求，不开入站端口、不改路由器；OpenClaw Gateway Token 始终留在本机。电脑和连接器需保持在线；退出或休眠后显示离线。`--local` 可设置本机回环地址端口，默认 `http://127.0.0.1:18789`。

Voxi 若使用自签 CA，从管理员已有的可信来源取得 CA 文件，将启动参数增加 `--ca /path/to/ca.crt`；不支持跳过 TLS 验证。可为后台进程使用 `VOXI_CONNECTOR_TOKEN`、`OPENCLAW_GATEWAY_TOKEN` 环境变量替代交互输入；不将密钥放进命令行参数、截图、日志或仓库。连接密钥丢失时，解除绑定并删除该连接后重新创建。当前连接器是手动运行程序，没有自动安装系统服务；进程退出时尚未送达的内存结果可能丢失，云端不自动重派不确定任务。

**云服务器 HTTPS**：填写 Voxi 云端可访问、证书有效的 Gateway HTTPS 根地址和 Token／密码，创建后检测。直连拒绝 URL 中的凭据、重定向和内网/保留 IP，DNS 实际解析结果也检查；内网地址、同机 Docker 私网或自签 OpenClaw 实例使用主动连接器即可。Token 使用现有 AES-GCM 主密钥加密，响应只给配置标志，不回显。

检测使用认证的 `GET /v1/models`。检测通过后，在所需频道选择该 OpenClaw 连接并保存，再到“后台任务”提交一个只读小任务验证执行流程。

当前 API 接入通过 `POST /v1/responses` SSE 终态确认完成；不以“已经做完”等正文判断。每个新任务有独立会话键，明确“继续”时复用原会话和原实例，频道后来改绑不会把继续操作转给另一个助手。中断或断线导致执行结果不明时不自动重试。已认领的家中任务不会因轮询/结果回传重试而重复派发；结果重复回传可确认同一终态。

OpenClaw 工具批准仍在其自身界面处理，当前不把它的批准窗口映射为 Voxi 的 Codex 批准按钮。直连停止等待会断开 HTTP 请求；家中连接器仍可能继续运行。界面明确显示“停止等待／核对远端”，不会把这一步标成远端已停止，必要时请在 OpenClaw 取消任务。OpenClaw 自己的运行时超时及工具权限仍由它管理。

协议依据：[Responses API](https://docs.openclaw.ai/gateway/openresponses-http-api)、[远程访问](https://docs.openclaw.ai/gateway/remote)。API 凭据具有该实例的操作权限，只接入可信的 Voxi 服务；不需要把 Gateway 18789 端口直接开放公网。

## 升级

在 Voxi 仓库运行下面命令。升级助手优先识别 `/etc/codex-pocket-autodeploy.json`，调用现有快照发布器；没有自动发布配置时，才核对容器对应的真实 Git 仓库并快进更新。不会把运行中的发布快照当作 Git 仓库，也不会删除命名卷或改账号配置。

```bash
set +e
cd ~/Voxi &&
git fetch origin &&
git merge --ff-only origin/main &&
sudo python3 deploy/upgrade-pocket-agent.py &&
sudo bash deploy/deploy.sh &&
sudo bash deploy/check-agent.sh
```

打开 `/admin/agent` 手动启用，默认 CH0 快问、CH1 Agent、CH2/CH3 未启用。先从后台提交一个小任务，再实测设备 PTT。旧 Pocket 不支持 `/voxi/agent` 时页面明确提示升级；原有语音路径仍可运行。

不要在交互式主机终端直接执行 `set -e`。它会让后续失败的检查退出整个终端会话；上面的 `set +e` 和 `&&` 链会停止失败后的升级步骤，同时保留终端。自动发布器使用 `git archive` 生成不含 `.git` 的运行快照，Docker 的 Compose working_dir 因而不能用来推定源码仓库。

## 设备

MiniCam 配套固件在新路由下使用 CH0–CH3 编号，显示 FAST/AGENT。`*` 表示有任务状态，`?` 表示等待输入/批准，`OK` 表示完成；不会让后台状态覆盖录音、播放或补缓冲状态。中文自定义频道名可在后台和 USB status 查看，当前 MiniCam 屏幕仍使用其原有 ASCII 字体。

语音任务先转写并保存，再通过原有 Codex 原生语音播报确认。设备切台/离线不取消任务，完成通知不自动插播。可主动说“查看进度”“读结果”“取消任务”“继续任务，……”；详细批准请求及输入问题在后台查看处理。

新版录音携带 `requestId`；同一录音重连重传保持编号，后台按用户和请求号去重。`ready` 增加 `name`、`channelMode`、`agentTasks`、`taskId`、`taskState`；新增 `task_state` 控制通知。原 PCM/Opus、批量和播放额度协议不变。旧固件可完成语音任务，但无新标记及同等跨连接重传去重保证。

## 验证与实际边界

代码验证覆盖真实 HTTP 管理代理到 SQLite、模拟 Codex / OpenClaw 事件、真实 Python 家中连接器经受信 HTTPS 的任务往返、请求去重、所有者校验、模板继承/恢复、断连/不确定状态、凭据加密/不回显、浏览器桌面与 390px 手机操作。外部 OpenClaw 服务为模拟，不能替代用户真实实例和真实录音验证。

当前是个人/试用部署；用户工作目录并不等于商业多租户隔离。自有 OpenClaw 的 HTTP/主动连接已实现，原生频道插件、配对安装包/自动启动、商业 API 执行、计费与独立托管工作器仍未实现。详见 Pocket Cloud 仓库 `VOXI_AGENT.md`。
