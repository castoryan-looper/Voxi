# MiniCam OTA 首次烧录与回归记录 — 2026-11-09

状态：首次 USB 安装成功，基础功能回归完成；完整在线 OTA 与回退尚待验证。

- 已确认正常音量加键 PTT 版 MiniCam，ESP32-S3 rev0.2 / 16 MB Flash / 8 MB PSRAM。
- 已备份旧分区表、NVS 与 PHY 共 32768 字节至本机私有工作目录；高速完整 Flash 备份未成功，不宣称有完整备份。私有数据不发布。
- 通过 ROM 读取备份后，擦除新录音缓存与 OTA 数据范围，写入 bootloader、分区表、对应应用及 app0 VALID 初始化状态。四个写入镜像均由 esptool 返回 Hash of data verified。
- 应用文件：1828032 字节；SHA-256 `1447464dc6fd7c68dc2d27e668fc3a90365f8b5727a37d8df73f012191ef07a9`。
- 启动返回 otaEnabled=true、otaTarget=zhengchen_minicam_20_ota、otaPendingVerify=false。首次 USB 安装是 app0 VALID，不等同于执行过一次在线升级确认。
- 原有设备配置可读；屏幕初始化成功、ES8388 可用、LittleFS 可用、20 秒 / 960000 字节录音缓存就绪，PSRAM 正确识别。4G TLS 连接和云端 READY 恢复。
- 网关真实 8 kbps Opus 样包在 S3 解码通过；错误帧拒绝通过。S3 编码 11 帧、0 错误，网关解码和尾帧能量通过。
- 本地扬声器测试执行；10 秒真实 4G 下行探测完整播放，480960 字节接收/消费一致，完整性校验通过；解码错误、扬声器写入错误均为 0。未进行人工听感认证。
- 20 秒 PCM 合成上传：关闭恢复时遇到 `4G WebSocket write failed (-78)`，该轮失败；开启恢复后发生一次重传，最终 uploadProbe=passed、cloudReady=true，录音/发送 CRC 均为 2784024299。这是 384 kbps PCM 诊断负载，正常语音使用 Opus；不把失败样本记为无故障通过。
- 临时切换 Wi-Fi 后，已保存网络未连接（reason 201）；未获得可用 WLAN，因此没有运行实际 HTTPS 固件下载。测试结束已恢复原 cellular 模式，重启约 8 秒后 cloudReady=true，录音缓存仍就绪。

尚待：可用 Wi-Fi 与测试发布端准备后，完成实际下载→切槽→自动重启→确认、坏 hash/错板型拒绝、下载断电和失败启动回退，以及真实麦克风对话、待机/唤醒回归。云端生产服务及生产 manifest 未改动，PR 保持草稿。
