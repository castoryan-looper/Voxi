# 公网设备数量管理

访问 `https://服务器IP:9443/admin/`。沿用网关现有 HTTPS 和 CA；没有新增公网端口。

页面显示在线连接、频道、对话活动、上传量、心跳及近期接入/拒绝/断线事件。可将同时在线上限设为 1–4 台，保存后立即生效，无需重启。设置保存在 `voxi_gateway_state` Docker 卷中，服务升级与重启后保留；`MAX_CONNECTIONS` 仅作为首次初始化默认值。不要删除该卷。

降低上限保留现有连接，待连接减少后限制新连接；如要立即释放名额，先关闭不使用的硬件，再在页面断开连接。在线设备会自动重连，因此“断开”不是永久禁用。旧固件不上传设备唯一标识，界面使用本次网关运行的连接编号，不能当作永久设备名称。

## 部署

语音后端和网关有独立上限。先更新 Pocket 后端（本次 compose 将 `VOXI_MAX_SESSIONS` 设为 4），再更新 Voxi：

```bash
sudo python3 /usr/local/lib/codex-pocket-autodeploy/autodeploy.py run --retry
sudo python3 /usr/local/lib/codex-pocket-autodeploy/autodeploy.py status
# 若显示 Another deployment is running，等部署完成后再查看 status。
cd ~/Voxi
git -c core.hooksPath=/dev/null pull --ff-only
sudo bash deploy/deploy.sh
sudo curl --cacert /etc/voxi/tls/ca.crt https://43.160.215.253:9443/healthz
docker exec codex-pocket-gateway-1 printenv VOXI_MAX_SESSIONS
docker exec voxi-gateway-1 printenv ADMIN_USERNAME
docker exec voxi-gateway-1 printenv ADMIN_INITIAL_PASSWORD
```

首次账户版部署自动创建用户名 `admin` 和随机初始密码。上述最后两条命令分别显示用户名和初始密码，直接填入管理页，不要贴到聊天。登录后可在「管理员账户」修改密码（8–128字符）。

账户密码使用带随机盐的scrypt哈希验证。修改后的哈希保存在网关持久卷 `/state/admin.json.account`，部署和重启保留，且优先于环境变量的初始哈希。修改密码后 `ADMIN_INITIAL_PASSWORD` 不再有效，只供首次登录；初始密码位于服务器root可读的 `/etc/voxi/gateway.env`。当前账户用户名可用 `ADMIN_USERNAME` 初始化，页面提供改密码，不提供多管理员管理。

浏览器使用HttpOnly、Secure、SameSite=Strict Cookie，会话最长8小时。刷新页面可恢复会话；退出立即失效，修改密码使全部管理会话失效，网关重启后需重新登录。写操作校验CSRF令牌与请求来源。登录每分钟最多8次失败尝试。账户配置存在时旧ADMIN_TOKEN及设备令牌均无法登录管理接口，现有设备配置不受影响。

忘记修改后的密码时，可在服务器上先备份 `/state/admin.json.account`，再通过服务器维护流程重置账户；不要删除整个持久卷（其中还有设备数量配置）。

若浏览器尚未信任现有私有 CA，请先导入 `/etc/voxi/tls/ca.crt`（仅公钥证书）。这不是公网受信任 CA 证书；本功能沿用现有证书方案。

## 验证范围

自动测试覆盖鉴权隔离、跨来源拒绝、动态扩容至4连接、降低上限保留连接、指定断开、非法值、持久化恢复及保存失败回退。后端最多4个会话是服务容量设置，真实账号的同时语音能力仍以实际运行结果为准。

本地 Docker 引擎未运行，未在此电脑执行容器级部署验证；线上需按上述命令部署并确认。设备无需重新烧录。

## AI 配置

管理页的「AI 提示词与语音配置」直接读写 Pocket 内部 `/voxi/config` 接口。支持全局提示词、四频道呼号/角色、无进展超时10–180秒、生成结束后的静音等待500–5000毫秒、媒体诊断间隔5–120秒、音频NACK重传开关和16/32/64/128包恢复窗口。提供默认值和完整合成提示词预览。语音固定开发者指令同时只读展示；模型由原生语音后端选择，音色cove/协议v3不开放未经验证的替换值。

配置保存在Pocket持久状态目录的 `voxi-config.json`，保存前完整校验并原子替换。保存后在新连接或切换频道时应用；当前故事不强制中断。需要立即应用时，等待故事结束后在管理页断开该连接，设备自动重连。需同时升级Pocket和Voxi，先升级Pocket；旧后端缺少接口时页面会明确提示。

重传仅在SDP成功协商generic NACK且aiortc版本为固定1.14.0时启用。日志 `Native voice audio recovery ... nackNegotiated=True` 表明协商成功。恢复适配器使用版本受限的接收器内部接口，测试覆盖缺包请求和乱序补包；实际跨公网能否恢复取决于上游重传支持与网络。若产生回归可在管理页关闭音频重传，重新连接后恢复默认接收器行为。

## 2026-11-04 播放诊断与优化

COM14实测收到和消耗2541120字节，CRC一致，扬声器写错误0，播放循环最大间隔22ms；期间缓冲耗尽6次，接收空档最大3048ms。Pocket同轮日志音频时间线缺口3020ms、接收空档3050ms，且RTP丢包累计从642增长到935，说明主要异常发生在上游语音到Pocket的WebRTC段。设备CRC无法检测这之前丢失的音频。

S3固件保留12秒PSRAM环形缓冲，将启动预缓冲提高到4秒；每次耗尽增加1秒，最多8秒，开机期间跨轮保留学习结果。C6仍用原有水位。代价是增加首声等待，无法凭空找回已丢失的语音。新版已烧录COM14并回读4000ms目标水位；部署云端后仍需长故事听感和丢包复测，不能据此宣称完全消除卡顿。

## AI 编辑器 v2 检查

点击读取会立即显示进度，12秒内结束或报错；后端鉴权、端口、版本、格式错误分别提示。读取失败保留已有编辑；保存后再次读取并比对全部字段，只有一致才提示核验成功。编辑未保存时重新读取要求确认。长提示词响应上限提高到1MiB，覆盖四频道完整提示词的合法最大组合。

更新后可执行 `sudo bash deploy/check-ai-config.sh` 检查与页面相同的后端读取链路；脚本不打印密钥或提示词内容。如果报告后端404，先执行Pocket自动部署并等待完成；如果报告鉴权失败，再执行 `sudo bash deploy/connect-pocket.sh codex-pocket-gateway-1`。浏览器页面应显示「AI 配置编辑器 v2」。

## 后台页面结构

统一侧边导航与独立地址：设备列表 `/admin/devices`、设备记忆 `/admin/devices/{唯一ID}/memory`、提示词 `/admin/ai/prompts`、语音参数 `/admin/ai/voice`、连接事件 `/admin/events`、管理员账户 `/admin/account`。`/admin/`仍进入设备管理。子页面可直接打开、刷新或通过浏览器前进后退；登录后保留访问目标。

设备列表不再展开详情表单，点击设备的长期记忆按钮进入其子页面。提示词和语音共用后端配置，但保存时先读取最新配置，只合并当前页字段，避免覆盖另一页设置。未保存编辑在站内切换、浏览器后退或刷新时提醒。设备轮询不会重置详情表单。

前端入口为 `gateway/admin.html`，行为为 `gateway/admin-app.mjs`，共享样式为 `gateway/admin.css`。新增页面可在客户端 `pages` 路由表和服务器允许路径中注册；所有私有数据仍通过已有管理员会话鉴权API读取，公开HTML壳不包含用户数据。静态资源按无缓存返回，升级后刷新加载新版本。

本次只更新Voxi网关页面与静态路由，后端记忆/配置协议和设备固件不变。浏览器测试覆盖详情直接刷新、导航、手机布局和两类AI配置分开保存。
