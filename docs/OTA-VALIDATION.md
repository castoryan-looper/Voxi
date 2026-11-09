# OTA 验证记录 — 2026-11-09

基于 Voxi main `50a13a7`，Windows / PlatformIO 6.2 / 项目固定 pioarduino 55.03.33 工具链。

- 最终构建通过：waveshare_s3g_ota、waveshare_amoled18_v2_ota、zhengchen_minicam_20_ota、zhengchen_minicam_20_gpio11_ptt_ota。
- 回归构建通过：waveshare_c6、waveshare_s3g（原单应用分区）。
- 网关完整测试 91 项通过，包括新增的发布接口授权与完整发布测试。
- Python OTA/发布/初始化 3 项、原分区保护 3 项通过；发布/迁移脚本 Python 编译与 --help 检查通过。
- 四款实际构建的 firmware.bin 均通过发布工具的芯片、目标标记和尺寸预检。
- S3g ELF 的 `verifyRollbackLater` 为强符号 T；所用 S3 SDK 配置 `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=1`。
- S3g 静态 RAM：原构建 69996 字节，OTA 70028 字节，增加 32 字节。Flash 报告原构建 1701363 字节，OTA 1730879 字节，增加 29516 字节。OTA 占 3 MiB 槽约 55%。这不包含临时 TLS 堆内存和额外栈深度，实机峰值未测。
- 新版基础 RAM / Flash 用量：AMOLED OTA 60332 / 1803275 字节；MiniCam OTA 70740 / 1827523 字节（固件实际文件因镜像头和对齐略大）。

## 尚未通过的实机验收

系统只列出 COM10，读取现有 status 时串口初始化返回 Windows 设备错误 31，不能确认板型。未刷写、未擦除设备 Flash、未改变设备配置，未发布生产 manifest，未部署生产云端。

因此当前是**待实机验收的候选实现**，不能声称真实 OTA/断电回退/声音回归已通过。必须在对应 S3 板上完成 OTA.md 中的正常更新、断网/断电、错误镜像与失败启动回退测试后，再启用生产自动发布。开发分支可供审查，勿把编译成功等同于硬件验收。
