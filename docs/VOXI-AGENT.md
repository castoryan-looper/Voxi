# Voxi Agent / Pocket Cloud 首版

产品方向：频道由用户命名和绑定；提供默认 Voxi Agent，并规划自有 OpenClaw 的本地/云端接入。本次按当前部署优先完成 Pocket Cloud + Codex 的可用路径，不迁移至新的 Agent 框架。

## 管理入口

- `/admin/agent`：启用任务路由、默认频道、每用户频道、模型覆盖、并发及时间上限、Agent 指令。
- `/admin/agent/tasks`：派发文本任务、查看持久状态与完整结果、批准/拒绝、回答问题、停止和继续。
- `/admin/agent/credentials`：供应商密钥加密保管和删除。当前仍用既有 Codex 登录，不会因填入密钥而切换执行器。

沿用现有管理员用户名/密码、HttpOnly 会话及 CSRF 防护，不新增公网 Pocket 控制接口。设备 token 不能登录管理员页面。

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

代码验证覆盖真实 HTTP 管理代理到 SQLite、模拟 Codex 状态事件、任务幂等、所有者校验、重启/不确定提交、批准、取消、继续、凭据加密/不回显、浏览器桌面与手机操作。MiniCam 和 C6 固件编译检查通过。模拟执行和编译不能替代云端部署及真实录音验证。

当前是个人/试用部署；用户工作目录并不等于商业多租户隔离。自有 OpenClaw 插件连接、商业 API 执行、计费与独立托管工作器暂未实现；后台明确区分已保存凭据和正在使用的执行器。详见 Pocket Cloud 仓库 `VOXI_AGENT.md`。
