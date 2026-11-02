# 网页配置与本机烧录

参考用户指定的 [codex-pocket](https://github.com/castoryan-looper/codex-pocket) 的交互：USB 网页优先、无 USB 时设备热点备用、Wi-Fi/云端连接在网页保存并重启。此实现为 Voxi 独立代码，不共享 Codex 的任务或设备令牌。

## 最快开始

本机运行：

```powershell
node tools/setup-server.mjs
```

在桌面 Chrome 或 Edge 打开 **http://127.0.0.1:8788/**，点击“连接 USB 设备”，选择 ESP32 的串口。当前这台设备为 COM6。页面通过 Web Serial 直接读写设备，localhost 服务只提供静态页面，不接收 Wi-Fi 密码或设备令牌。

1. 扫描并选择 2.4GHz Wi-Fi，填写密码。隐藏网络可直接填写名称。
2. 云端默认 `43.160.215.253`、`9443`、TLS 开启。
3. 从服务器读取本设备的令牌和公共根 CA，分别粘贴到网页：

```bash
sudo grep '^DEVICE_TOKEN=' /etc/voxi/gateway.env
sudo cat /etc/voxi/tls/ca.crt
```

4. 点击保存并重启。设备保存前会验证字段和 PEM 证书。若重启后浏览器串口断开，重新点击连接即可；部分 USB 控制器会保留连接并继续刷新状态。
5. 页面显示云端就绪后，按住 BOOT 超过 0.3 秒再松开。mock 模式返回测试音。

Wi-Fi 密码和设备令牌写入设备 NVS，读取配置只返回“是否已设置”，不回传密文或明文。修改同一网络时密码留空保留；切换新网络必须填密码，或显式勾选开放网络。设备令牌留空保留。根 CA 是公共证书，可以回显编辑。OpenAI Key 仍只保存在云端。

## 云端入口

网关更新到本版本后也提供 `https://43.160.215.253:9443/setup/`。Web Serial 需要受信任 HTTPS；私有 CA 尚未被电脑信任时优先使用本机 localhost 入口。配置数据由浏览器直达 USB 设备，不发送给网关。网页支持导入含 host、port、tls、token、ca 的 JSON，文件仅在浏览器本地读取。

## 设备热点备用

没有 USB 主机数据连接时，同时按住 BOOT + PWR 约 3 秒。墨水屏显示 VOXI 热点和 KEY；KEY 同时是热点密码和网页登录密码。连接后打开 `http://192.168.4.1/`。首次无配置或断网超过 30 秒也会进入设置入口。检测到 USB 主机时自动关闭配置热点，屏幕改为 USB 配置提示。仅充电不算 USB 主机连接。

当前只记住一组 Wi-Fi；多网络记忆、BLE 旋钮配对等 codex-pocket 扩展功能尚未移植。

## 后续编译与烧录

固件不再要求填写 config.h。可选 config.h 仅用于音量和引脚等硬件覆盖，否则使用 config.example.h。烧录前先在网页点击“断开连接”，释放串口。

```powershell
$env:PYTHONUTF8='1'
$env:PYTHONIOENCODING='utf-8'
python -m platformio run --project-dir firmware-c6 --target upload --upload-port COM6
```

Windows 使用 Python 3.12 环境中的 PlatformIO。UTF-8 环境变量避免烧录进度条触发 GBK 编码错误。新固件在预构建步骤把 gateway/setup.html 嵌入设备，生成的 setup_page.h 不提交 Git。正常升级不主动清除 voxi-radio 配置；不要执行整片擦除，否则需重新设置。
