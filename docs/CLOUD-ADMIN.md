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
docker exec voxi-gateway-1 printenv ADMIN_TOKEN
```

首次新版部署自动生成独立的 64 位随机十六进制管理密钥，保存在 `/etc/voxi/gateway.env` 的 `ADMIN_TOKEN` 中。最后一条命令的输出直接填入管理页，不要贴到聊天或日志。

设备令牌无法登录管理页。管理密钥只保存在页面内存，刷新/关闭页面后重新登录；接口要求 Bearer 鉴权并校验浏览器请求来源。不向前端返回设备令牌、Pocket 令牌、账号登录信息或 Wi-Fi 密码。

若浏览器尚未信任现有私有 CA，请先导入 `/etc/voxi/tls/ca.crt`（仅公钥证书）。这不是公网受信任 CA 证书；本功能沿用现有证书方案。

## 验证范围

自动测试覆盖鉴权隔离、跨来源拒绝、动态扩容至4连接、降低上限保留连接、指定断开、非法值、持久化恢复及保存失败回退。后端最多4个会话是服务容量设置，真实账号的同时语音能力仍以实际运行结果为准。

本地 Docker 引擎未运行，未在此电脑执行容器级部署验证；线上需按上述命令部署并确认。设备无需重新烧录。
