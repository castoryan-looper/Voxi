# 腾讯云部署：在管理页面终端输入命令

仓库：https://github.com/castoryan-looper/Voxi 。主机 IP：43.160.215.253。
8448 已返回 HTTPS 响应，保留现有服务。Voxi 默认对外使用 **9443/TCP**，内部网关只映射 127.0.0.1:8787。以下为 Linux Docker Compose 方案；不需要 SSH、GitHub Actions 密钥或 Webhook 公网端口。

## 1. 首次安装

在管理页面打开**主机终端**（不是 Docker 容器内终端），先检查：

```bash
cat /etc/os-release
docker compose version
```

若已经有 Docker 和 Compose v2，跳过安装。以下安装命令针对 **Ubuntu 24.04**：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl docker.io docker-compose-v2
sudo systemctl enable --now docker
```

其他系统按[腾讯云 Docker 文档](https://intl.cloud.tencent.com/document/product/213/37516?lang=en)安装 Docker Engine 和 Compose v2，再继续；脚本不会修改已有管理面板或反向代理。

首次部署：

```bash
sudo git clone https://github.com/castoryan-looper/Voxi.git /opt/voxi
cd /opt/voxi
sudo bash deploy/bootstrap.sh 43.160.215.253
```

如果 `/opt/voxi` 已存在，先查看内容，已有本仓库则 `cd /opt/voxi && sudo git pull --ff-only`；不要删除已有目录。

脚本会创建随机设备令牌、IP 证书、构建模拟网关、启动 Caddy TLS 代理，安装每分钟更新一次的 systemd timer。需要能访问 GitHub、npm 和 Docker 镜像源。首次下载工具和镜像可能较慢。

在腾讯云安全组/轻量服务器防火墙放行 **TCP 9443**。主机防火墙如也启用，增加相同端口规则。**8787 不对公网放行**。

## 2. 验证

```bash
curl -fsS http://127.0.0.1:8787/healthz
sudo curl --cacert /etc/voxi/tls/ca.crt https://43.160.215.253:9443/healthz
sudo docker compose --env-file /etc/voxi/deploy.env -f /opt/voxi/compose.yaml ps
sudo systemctl list-timers voxi-update.timer
```

返回 `{"ok":true,"mode":"mock","revision":"<commit SHA>"}` 即进程健康。这项检查**不代表模型 API 可达**，还要用设备完成一次真实语音往返。浏览器不认识私有 CA 时提示证书不受信任是预期现象，设备会显式信任此 CA。

## 3. 配置设备

在管理终端读取：

```bash
sudo grep '^DEVICE_TOKEN=' /etc/voxi/gateway.env
sudo cat /etc/voxi/tls/ca.crt
```

将令牌写入本地 `firmware-c6/include/config.h`，把 **ca.crt 公共证书完整内容**放入 `GATEWAY_ROOT_CA`。服务器私钥 `ca.key`、`server.key` 不离开主机。设备地址为：

```cpp
#define GATEWAY_HOST "43.160.215.253"
#define GATEWAY_PORT 9443
#define GATEWAY_TLS 1
```

`GATEWAY_HOST` 不带协议或路径。固件通过 SNTP 校时后再建立带 CA 校验的 WSS；允许设备访问 NTP（UDP 123）。墨水屏仍显示 CONNECTING 时先查看串口。不要把本地 config.h 提交到 GitHub。

## 4. 切换真实 AI

```bash
sudo nano /etc/voxi/gateway.env
```

修改 `MODE=openai`，填入 `OPENAI_API_KEY`，保留随机 `DEVICE_TOKEN`。默认模型 `gpt-realtime-2.1`、声音 `marin` 可按账号权限修改。Key 仅在服务器本地保存，不上传仓库。

```bash
cd /opt/voxi
sudo bash deploy/deploy.sh --force
sudo docker compose --env-file /etc/voxi/deploy.env logs --tail=100 gateway
```

配置改动需要 `--force`，否则同一提交会跳过已健康运行的版本。

## 5. 以后怎么更新

电脑提交并推送到 `main` → 主机 timer 最多约一分钟后 `git pull --ff-only` → 构建镜像并运行测试 → 启动候选容器检查 → 重建服务并等待健康状态。更新会短暂中断当前对话，设备重连。

也支持管理终端手动拉取：

```bash
cd /opt/voxi
sudo git pull --ff-only
```

bootstrap 安装的 `post-merge` hook 会在有合并更新时自动部署。已经是最新提交时 Git 不触发 hook，可执行：

```bash
sudo bash deploy/deploy.sh --force
```

脚本内置锁，防止手动更新与 timer 同时操作；自动 pull 会禁用嵌套 hook，避免锁互相等待。追踪文件被本地修改或分支不是 main 时自动更新会停下，不会强制覆盖本地改动。凭证、证书和运行配置在 `/etc/voxi`，不受 git pull 影响。

GitHub Actions 负责网关测试、镜像构建和 C6 编译；服务器拉取的是 main，**不等待 Actions 结论**，但部署时 Docker 构建会再跑网关测试。建议 main 只合入通过 CI 的代码。

## 6. 日志、暂停与回退

```bash
sudo journalctl -u voxi-update.service -n 100 --no-pager
sudo systemctl stop voxi-update.timer
```

候选检查不通过会保留旧服务；切换后网关不健康时尝试恢复 `.deploy/active-tag` 记录的旧镜像。自动回退仅覆盖网关镜像，不回退 Git 工作区、配置、代理镜像或证书；下轮 timer 会重试最新代码。

手动回退前先停 timer，查看已有镜像标签，然后选择一个真实存在的旧 SHA：

```bash
sudo docker image ls voxi-gateway
cd /opt/voxi
# 替换 OLD_SHA 为上条命令中的旧版本标签
sudo env VOXI_IMAGE_TAG=OLD_SHA docker compose --env-file /etc/voxi/deploy.env up -d --no-deps gateway
```

恢复自动检查：`sudo systemctl start voxi-update.timer`。当前不自动清理旧镜像，定期查看磁盘空间，确认回退窗口后再手动清理。

证书服务证书有效期 825 天，根 CA 10 年；应在到期前续签服务证书并重启代理，不必轮换根 CA。更换根 CA 需要同步更新设备固件；更换主机 IP 需要重新签发带正确 SAN 的服务证书。以后有域名可换成 Caddy 自动公共证书方案。
