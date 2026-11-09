# Voxi 云端管理后台

访问 `https://服务器IP:9443/admin/`。沿用网关现有 HTTPS 和 CA；没有新增公网端口。

登录后进入「运营总览」。在线设备按设备唯一 ID 去重，旧固件使用连接编号。设备管理继续提供频道、状态和断开指定连接；连接事件可在独立页面查询。设备可以自动重连。

## 总览口径

- 用户档案包含设备首次连接时建立的档案。网页登录账户单独计数，近 7 天上线用户按设备绑定的档案去重。
- 设备接入不再读取旧在线数量上限。Pocket Cloud 保留 `VOXI_MAX_SESSIONS` 个实时语音席位，空闲席位可按需让给其他设备。未预热的设备可以录音，首次回复需要等待语音会话建立。全部席位忙时保持在线，本次录音未受理，可稍后重试。
- 可接待人数估算为当前可分配的同时语音席位，包含空闲预热席位。配置值只用于调度，注册用户容量需通过实际压测评估。
- 语音轮次和说话时长从本版开始采集，统计已受理的有效设备输入，不含等待和扬声器播放，今日按北京时间计算。持久化汇总不包含录音或对话内容。
- Token 按 Voxi Agent 会话使用 Codex 上报的累计值，同一会话继续执行时只取最新累计。旧版仅存的最近一次调用用量不计入累计。后台任务总数包含 Voxi Agent 与 OpenClaw，实时语音、外部 OpenClaw 和未上报会话用量暂缺。

## 部署

先更新 Pocket 后端，再更新 Voxi 网关。现有 compose 配置提供 4 个原生语音席位：

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

自动测试覆盖鉴权隔离、跨来源拒绝、六台设备同时接入、空闲语音席位回收、全部忙碌时设备继续在线，以及指定断开。

本地 Docker 引擎未运行，未在此电脑执行容器级部署验证；线上需按上述命令部署并确认。设备无需重新烧录。

## 助手与语音设置

在「频道与助手」选择要设置默认频道还是某位用户。同页的「助手怎么工作」可设置快问的默认回答方式和 Voxi Agent 的默认任务规则。音色和试听集中在「语音与试听」，超时、静音等待和音频重传收在该页的「语音运行参数」。

快问和语音配置保存在 Pocket 持久状态目录的 `voxi-config.json`，保存前校验并原子替换。新连接或切换频道时应用语音设置。部署时先升级 Pocket Cloud，再升级 Voxi 网关。

重传仅在SDP成功协商generic NACK且aiortc版本为固定1.14.0时启用。日志 `Native voice audio recovery ... nackNegotiated=True` 表明协商成功。恢复适配器使用版本受限的接收器内部接口，测试覆盖缺包请求和乱序补包；实际跨公网能否恢复取决于上游重传支持与网络。若产生回归可在管理页关闭音频重传，重新连接后恢复默认接收器行为。

## 2026-11-04 播放诊断与优化

COM14实测收到和消耗2541120字节，CRC一致，扬声器写错误0，播放循环最大间隔22ms；期间缓冲耗尽6次，接收空档最大3048ms。Pocket同轮日志音频时间线缺口3020ms、接收空档3050ms，且RTP丢包累计从642增长到935，说明主要异常发生在上游语音到Pocket的WebRTC段。设备CRC无法检测这之前丢失的音频。

S3固件保留12秒PSRAM环形缓冲，将启动预缓冲提高到4秒；每次耗尽增加1秒，最多8秒，开机期间跨轮保留学习结果。C6仍用原有水位。代价是增加首声等待，无法凭空找回已丢失的语音。新版已烧录COM14并回读4000ms目标水位；部署云端后仍需长故事听感和丢包复测，不能据此宣称完全消除卡顿。

## 后台页面结构

侧边栏按「设备与用户」「助手与语音」「系统」分组。`/admin/` 进入运营总览，设备管理在 `/admin/devices`，频道与助手在 `/admin/agent`，语音与试听在 `/admin/ai/voice`。旧提示词地址 `/admin/ai/prompts` 跳到「助手怎么工作」。子页面可直接打开，登录后保留访问目标。

「用户账户」列出全部用户档案，可用称呼或登录名搜索。进入用户详情后管理资料与登录账户、设备绑定、长期记忆和后台任务。设备列表的所属用户链接会进入详情，旧的设备记忆地址会定位到所属用户的记忆页。

频道、助手行为、音色和运行参数各自保存，Pocket Cloud 只更新所提交的字段。未保存编辑在离开页面时提醒，设备轮询会保留表单草稿。

前端入口为 `gateway/admin.html`，行为为 `gateway/admin-app.mjs`，共享样式为 `gateway/admin.css`。新增页面可在客户端 `pages` 路由表和服务器允许路径中注册；所有私有数据仍通过已有管理员会话鉴权API读取，公开HTML壳不包含用户数据。静态资源按无缓存返回，升级后刷新加载新版本。
