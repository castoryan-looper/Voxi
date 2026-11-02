# 小磁盘服务器与旧 Codex Docker

这次日志里构建和三项测试都成功，启动失败于 `Bind for 127.0.0.1:8787 failed: port is already allocated`。这是端口冲突，尚无磁盘满的证据。新版网关只在 Docker 网络中使用 8787，主机只发布 9443；已有 Codex 的 8787 服务可继续运行。

## 从失败的首次部署恢复

在服务器管理终端执行：

```bash
cd ~/Voxi
sudo systemctl stop voxi-update.timer 2>/dev/null || true
# 避免旧 post-merge hook 在更新过程中重复部署
git -c core.hooksPath=/dev/null pull --ff-only
sudo bash deploy/space.sh
```

`space.sh` 默认只报告宿主磁盘、Docker 占用、全部容器（含停止的）、镜像与卷，不删除资源。重点查看 `df` 的剩余空间、`docker system df` 的 Images/Build Cache，以及旧 Codex 容器占用。

如果构建缓存很大，可以释放 7 天前未使用的构建缓存：

```bash
sudo docker builder prune -f --filter 'until=168h'
```

这会影响整台主机的旧构建缓存，之后相关镜像重新构建可能慢一些；不删除容器或卷。旧版 legacy builder 的部分中间镜像不一定包含在这里，可以单独检查 `docker image ls --filter dangling=true`，确实不需要时执行 `sudo docker image prune` 并阅读确认列表。

清理后重试：

```bash
cd ~/Voxi
sudo bash deploy/bootstrap.sh 43.160.215.253
sudo curl --cacert /etc/voxi/tls/ca.crt https://43.160.215.253:9443/healthz
sudo systemctl status voxi-update.timer --no-pager
```

## Voxi 自身如何控制增长

- 相同 Git SHA 的镜像已经存在就复用，修改环境配置后 `--force` 只重建容器，不重复构建镜像。
- 成功更新后保留 `.deploy/active-tag` 和 `.deploy/previous-tag` 两个版本；清理其他 `voxi-gateway:<40位SHA>` 标签。任何容器引用中的镜像也保留。
- 首次部署还没有 active-tag 时保留所有版本，不猜测旧版本的用途。记录建立后才自动回收过期版本。
- 只自动 prune 带 `io.voxi.project=voxi` 标签的悬空镜像，不自动清理整个 Docker 构建缓存、其他项目容器、镜像或数据卷。
- 网关和代理各最多保留两份 5MB 日志，合计约 20MB，不含 Docker 元数据与其他服务日志。
- 构建前检查 Docker 数据目录所在文件系统至少有 512MiB 可用；这是下限，不保证首次拉取及解压峰值一定足够。缺空间就提前停止并提示。

手动执行相同的 Voxi 镜像清理：

```bash
cd ~/Voxi
sudo bash deploy/space.sh --clean-voxi
```

不会自动清理旧 Codex：仅凭名称无法判断哪些镜像、容器层、挂载目录和卷仍有需要保留的数据。

## 需要卸载旧 Codex 时

先从 `space.sh` 的容器列表找到准确名称，再查看挂载与镜像：

```bash
# 用实际旧 Codex 容器名替换 OLD_CODEX_CONTAINER
sudo docker inspect --format '{{json .Mounts}}' OLD_CODEX_CONTAINER
sudo docker inspect --format '{{.Config.Image}}' OLD_CODEX_CONTAINER
```

容器删除会丢失其可写层中的文件，先备份需要的内容（例如 `docker cp 容器名:/需要的目录 ./备份目录`）。确认旧服务不用、数据已保存后，按准确名称停止并删除容器，再删除确定不再使用的镜像：

```bash
sudo docker stop OLD_CODEX_CONTAINER
sudo docker rm OLD_CODEX_CONTAINER
# 用上一步查到且确认不再需要的镜像引用替换
sudo docker image rm OLD_CODEX_IMAGE
```

这里不加 `-v` 或强制删除参数，保留挂载卷。不要用 `docker system prune -a --volumes` 代替定向处理。

依据：[Docker 官方资源回收说明](https://docs.docker.com/engine/manage-resources/pruning/)。
