# MiniCam Wi-Fi TLS 内存修复 · 2026-11-07

切换到已保存的 Wi-Fi 后，设备曾完成关联，但 TLS 反复报 `SSL - Memory allocation failed`（-32512），屏幕 OFFLINE，尚未开始云端语音对照。不能把该故障当作 Wi-Fi 网络质量结论。

## 修改

此前 `boardInit()` 无条件调用 `minicamModemBegin()`，不论配置选择 Wi-Fi 还是 cellular，都会分配 4G UHCI 的 64×512 字节内部 DMA 池及 4096/6144 字节任务栈，并启动串口和模组管理。单这些内部内存就约 42KiB，尚未计入其他结构。

现在板级初始化只保留诊断需要的互斥锁和事件组；`setupBegin()` 读取持久化联网方式后，仅在 cellular 模式通过 `minicamModemConfigure(true, ...)` 启动重资源。4G 启动使用原先相同的 UART、DMA 和任务参数，且只初始化一次。Wi-Fi 下的关闭与待机路径可在未启动模组时安全返回。联网模式切换仍通过保存后重启生效，没有实现运行中跨任务销毁 DMA。

诊断新增 `cellularResourcesActive`；Wi-Fi 下为 false、UART 驱动状态为 not started。通用诊断新增 `internalFreeHeap` 与 `internalLargestFreeBlock`，用于区分总空闲量和连续分配能力。TLS、CA 与主机名校验保持。

## 实测

MiniCam 标准目标构建通过，仅向已识别的 COM15/`esp32-d453097e9ec4` 的 `0x10000` 写应用，校验通过；原 NVS、证书、令牌及网关保留。

- Wi-Fi 关联后云端 READY，仍为 8kbps Opus。
- TLS 建立后内部空闲约 44828 字节，最大连续块约 31732 字节；4G 资源未启动。
- 实机 Opus 下行解码、错序/非法包拒绝通过。
- 实机 Opus 上行编码与 Node 解码通过，11 帧、499 字节、无编码错误，尾音能量校验通过；自检后仍 READY。
- 模式回切检查：重启切回 cellular 后 `cellularResourcesActive:true`，4G 云端 READY、8kbps，内部空闲约 39608 字节；随后切回 Wi-Fi 继续对照。MiniCam GPIO11 改装目标也编译通过，未刷入该改装目标。

这证明该板的 Wi-Fi 连接和本地编解码已恢复，不代表长语音稳定性或所有网络条件通过。模式回切的实机结果与最终使用模式以本次交付报告为准。无需更新云端。
