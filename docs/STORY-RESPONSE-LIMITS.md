# 长回复超时与提示词（2026-11-03）

设备证据：lastFault 与 turnFailure 均为 Codex voice response timed out；receivedBytes=1341120，约27.94秒PCM；本轮播放重新缓冲为0。Pocket仓库基线 a86d196 的 bridge/voxi.py 在松手后 sleep(录音秒数+30)，不论是否仍在正常回复都发送错误并关闭连接。这与本轮中断一致。

## 项目原提示词

当前频道下标1，巡逻二号。Pocket 的 thread/realtime/start prompt 全文为：

> 你是虚构对讲机里的AI伙伴，呼号巡逻二号：干练的搭档。用简短自然中文直接回应，通常一到三句，十秒内说完。偶尔说收到或完毕，不要每句重复。不要模拟电流声，不要执行任务或使用工具。听不清就请求重说。身份被问及时如实说明是AI。

thread/start 的 developerInstructions 全文为：

> Voice conversation only. Do not use tools, files, agents or shell commands.

会话设置：ephemeral=true，sandbox=read-only，includeStartupContext=false，clientManagedHandoffs=true，语音版本v3，voice=cove。四频道呼号分别为营地一号：沉稳值守员、巡逻二号：干练的搭档、夜航三号：安静的老朋友、探索四号：好奇的队友。

以上为仓库基线中项目发送的全部提示词字段，不是线上容器实读，不包含服务提供方内部指令。Voxi gateway/radio.mjs 的长版本说明用于 openai 模式，不是当前 Pocket 后端使用的提示词。

## 本地修复（尚未部署）

- Pocket 改为进展超时：首包等待预算为录音时长+30秒；起音后只在连续30秒无有效音频时结束，无项目定义的总回复时长上限。静默RTP不计作有效音频。旧轮看门狗不影响新轮。
- Pocket 提示词默认简短，但明确要求故事/详细讲解时按要求讲完，不受10秒和句数限制。
- Voxi 的30分钟会话轮换在Pocket忙于录音/思考/回复时延期，避免中途轮换切断长回答。
- 不承诺上游模型/服务本身无限时长，也不改变20秒录音输入上限。

测试：Voxi 20项通过；Pocket test_voxi 15项中10项通过、5项依赖原生WebRTC/音频库的测试因本机未安装依赖跳过。新增覆盖长回复超过120秒仍有进展、30秒停滞、旧轮定时器隔离。本次尚无生产长故事实测。

部署涉及 Voxi 与 codex-pocket-cloud 两个仓库。当前改动仅在本地；本机无已核验的腾讯云SSH连接，尚未读取线上部署版本或发布修复。
