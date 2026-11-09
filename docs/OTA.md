# ESP32-S3 云端 OTA

## 性能与适用范围

OTA 不常驻额外下载任务，不改变 Opus、音色、录音、PSRAM 播放缓冲或 4G 传输参数。只在连续空闲 15 秒后执行；首次检查最早开机 60 秒，此后约 30 分钟加随机抖动。进入检查前等待网络任务确认停止，并关闭语音连接；检查和升级期间不能对讲，结束后恢复连接。完整升级最长 5 分钟，通常由网络速度决定。不开启自动唤醒：深睡或暖待机期间不轮询。

支持四款独立 OTA 目标：`waveshare_s3g_ota`、`waveshare_amoled18_v2_ota`、`zhengchen_minicam_20_ota`、`zhengchen_minicam_20_gpio11_ptt_ota`。GPIO11 改板与未改板禁止混刷。C6 和原有单分区构建不启用 OTA。MiniCam 本版通过已配置 Wi-Fi 升级，cellular 模式不下载固件。

8 MB S3 使用两个 3 MiB 应用槽、约 2 MiB 录音区；16 MB 板使用两个 4 MiB 应用槽、约 8 MiB 录音区。NVS 仍在 0x9000–0xefff，PHY 仍在 0xf000；保留原有配置。录音区满足现有 20 秒 / 960000 字节 PCM 缓存及余量。固件文件随网络流以 4096 字节缓冲写入 Flash，不完整装入 RAM；HTTPS 内存只在检查/下载期间分配，动态内存峰值尚需实机测量。

## 一次性 USB 安装

现有 factory 分区无法通过普通应用 OTA 安全改变分区表。首次必须 USB 安装 OTA 引导程序、分区表与应用。不要对旧板直接执行 OTA，也不要用 `erase-flash`，不要把 boot_app0.bin 写到 0xe000（会破坏 NVS）。不要使用普通 `pio -t upload` 代替本迁移脚本。

例：S3 彩色墨水屏（其他板替换为完全对应的目标）：

```sh
pio run -d firmware-c6 -e waveshare_s3g_ota
python -m pip install esptool==5.1.0
python tools/bootstrap_ota.py --port COM10 --target waveshare_s3g_ota --backup-dir work/private-ota-backup-01 --erase-recording-cache
```

脚本先读取并保存旧分区表、NVS/PHY；只有备份成功才继续。重建录音区并清空 OTA 状态，写入应用及指向 app0 的 VALID 初始状态，使首次在线升级也有已知的回退槽。只擦除新录音区及 OTA 数据区，旧缓存与未完成录音不保留。私有备份包含登录资料，不能提交进仓库。迁移期间必须保持 USB 和供电；中断可重新通过 USB 恢复。脚本拒绝覆盖已有备份目录。

## 云端发布

本功能位于 Voxi 网关，Pocket 后端无需改动。Compose 将 `/etc/voxi/firmware` 只读挂载到 `/firmware`；部署脚本创建目录。HTTP 由既有 Caddy TLS 终止，设备继续使用已保存的 CA 与设备 Bearer 令牌；不降级 HTTP，不跳过证书验证，不跟随重定向，不向第三方主机发送令牌。

部署包含本功能的 Voxi 网关后，发布构建好的**应用 firmware.bin**（不要发布整片 Flash、bootloader 或 partitions.bin）：

```sh
sudo python3 tools/publish_firmware.py --image firmware-c6/.pio/build/waveshare_s3g_ota/firmware.bin --destination /etc/voxi/firmware --target waveshare_s3g_ota --version 2026.11.09-1
```

发布工具检查 S3 芯片标识、目标板唯一标记、镜像大小；先原子安装按 SHA-256 命名的不可变镜像，再原子替换 manifest。文件权限允许只读容器访问。替换 manifest 即启用该目标板的自动升级，无需重启云端。首次部署没有 manifest 时返回无更新。撤回尚未安装的发布可移走该目标的 manifest；停止发布不会回滚已启动成功的设备。

设备端只从既有网关固定路径拉取：

- `GET /api/firmware/<target>/manifest.json`
- `GET /api/firmware/<target>/<sha256>.bin`

只有持有设备令牌才能读取。镜像依靠 TLS 来源认证、SHA-256 和 IDF 镜像校验；本版未配置 Secure Boot/eFuse 签名，不能抵御云端发布权限被攻破。版本文字仅用于管理，发布者可有意发布旧构建；没有烧写不可逆防降级 eFuse。

## 安全切换与回退

设备验证目标板、schema、长度、槽容量；下载中检查超时、总时限及完整 SHA-256，扫描精确的板型标记。IDF 再检查芯片、镜像格式和内部校验。失败只影响备用槽，不选择不完整镜像。先保存候选 hash，最后设置启动分区，成功后自动重启。下载和写入阶段断电继续使用旧固件；最终 OTA 数据切换使用 IDF 双扇区机制。

使用 SDK 的 rollback-enabled 引导程序，覆盖 Arduino 默认的过早确认钩子。新版本启动后，基础配置、录音缓存、PSRAM 播放区和云端 READY 必须正常，开机至少 30 秒且连续健康 10 秒后才确认；180 秒未通过则回退。新固件启动崩溃/重启时，由引导程序拒绝尚未确认的版本。断网也可能使正常候选回退，这是主动选择的保守策略。回退后隔离失败 hash，避免循环升级；换一个修复构建后再发布。

该检查不等同于所有产品功能测试。每次固件发布仍须在对应板型验证真实录音、播放、音色切换、待机唤醒、联网及硬件按键；已经确认的新版本若日后才出现功能缺陷，需再发布修复版本。不能承诺任何新功能绝无缺陷。

## 状态与验收

USB `voxi_config` 的 `status` / `config` 返回 `otaEnabled`、`otaTarget`、`otaState`、`otaPendingVerify`。升级时屏幕显示 UPDATING；失败状态可区分连接、manifest、长度、校验、Flash 和启动验证。原有固件不启用 OTA。

自动检查覆盖发布路径认证、不可用镜像、错误目标、超大 manifest、双分区边界、缓存容量与保留 NVS；CI 编译四款 OTA 板。实机发布前须验证：正常升级并确认、下载中断网/断电、启动未 READY 自动回退、坏 SHA/错误板型拒绝、回退后不重装失败版本，以及升级前后对讲/录音缓存恢复。实测记录见 `OTA-VALIDATION.md`。
