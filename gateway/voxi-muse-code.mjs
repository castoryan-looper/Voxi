// Voxi's outbound connector for the official Muse Code SDK. Run on the Muse host.
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const approvalMode = 'denyUnmatched';
const idPattern = /^[a-f0-9]{32}$/;
const threadPattern = /^voxi-[a-f0-9]{32}-[a-f0-9]{32}$/;

async function pairingToken() {
  if (process.env.VOXI_CONNECTOR_TOKEN) return process.env.VOXI_CONNECTOR_TOKEN;
  const { stdin, stderr } = process;
  if (!stdin.isTTY) throw Error('非交互环境请设置 VOXI_CONNECTOR_TOKEN。');
  stderr.write('Voxi 配对密钥（输入隐藏）：');
  stdin.setRawMode(true);
  stdin.resume();
  try {
    let token = '';
    for await (const chunk of stdin.iterator({ destroyOnReturn: false })) {
      for (const byte of chunk) {
        if (byte === 3) throw Error('已取消配对。');
        if (byte === 13 || byte === 10) return token.trim();
        if (byte === 127 || byte === 8) token = token.slice(0, -1);
        else if (byte >= 32 && byte < 127 && token.length < 128) token += String.fromCharCode(byte);
      }
    }
    throw Error('未读取到配对密钥。');
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    stderr.write('\n');
  }
}

async function windowsLauncherBinary() {
  if (process.platform !== 'win32') return undefined;
  const directories = (process.env.PATH || '').split(';').filter(Boolean);
  if (process.env.LOCALAPPDATA) directories.push(join(process.env.LOCALAPPDATA, 'Programs', 'muse'));
  for (const directory of directories) {
    try {
      await stat(join(directory, 'muse.cmd'));
      const version = (await readFile(join(directory, '.muse-version'), 'utf8')).trim();
      if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version)) continue;
      const binary = resolve(directory, 'muse-bin-' + version + '.exe');
      if ((await stat(binary)).isFile()) return binary;
    } catch {}
  }
  return undefined;
}

function relay(url, token, ca, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: 'POST', ca, signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      const chunks = [];
      let bytes = 0;
      res.on('error', reject);
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 262144) res.destroy(Error('Voxi 响应过大。'));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(Error('Voxi HTTP ' + res.statusCode));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(Error('Voxi 响应格式无效。')); }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

export async function executeMuse(client, job, workspace, state, signal) {
  const fail = result => ({ state: 'failed', result });
  if (!idPattern.test(job.id) || !threadPattern.test(job.session) || typeof job.text !== 'string') {
    return fail('Muse Code 任务格式无效。');
  }
  const file = join(state, job.session + '.session');
  let session;
  let submitted = false;
  try {
    if (job.resume) {
      const sessionId = (await readFile(file, 'utf8')).trim();
      session = await client.resumeSession({ sessionId });
      await session.setApprovalMode(approvalMode);
    } else {
      session = await client.startSession({ workspaceRoot: workspace, approvalMode });
      await writeFile(file, session.sessionId, { flag: 'wx', mode: 0o600 });
    }
    if (signal.aborted) return fail('任务在送入 Muse Code 前已停止。');
    submitted = true;
    const { outcome, finalText, usage } = await session.run(job.text, { signal });
    const result = (finalText || '').slice(-32000);
    if (outcome.kind === 'terminalUnknown') {
      return { state: 'delivery_unknown', result: 'Muse Code 的进程结束，未取得任务结果。请在主机核对。' };
    }
    const ok = outcome.kind === 'completed' && outcome.params.terminal === 'completed';
    const inputTokens = usage?.inputTokens;
    const outputTokens = usage?.outputTokens;
    const counts = Number.isSafeInteger(inputTokens) && Number.isSafeInteger(outputTokens)
      ? { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } : undefined;
    return {
      state: ok ? 'completed' : 'failed',
      result: result || (ok ? 'Muse Code 已完成任务。' : 'Muse Code 未完成任务，请检查主机上的登录、权限或会话。'),
      usage: counts,
    };
  } catch {
    return submitted
      ? { state: 'delivery_unknown', result: 'Muse Code 未返回可确认的结果，请在主机核对。任务不会自动重发。' }
      : fail(job.resume ? '无法继续 Muse Code 会话，请检查原主机和项目目录。' : '无法创建 Muse Code 会话，请检查主机登录、项目权限及版本。');
  } finally {
    if (session) await session.leave().catch(() => {});
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    server: { type: 'string' }, connection: { type: 'string' }, workspace: { type: 'string' },
    ca: { type: 'string' }, 'muse-bin': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node voxi-muse-code.mjs --server https://Voxi地址 --connection 连接编号 --workspace 项目目录 [--ca CA文件] [--muse-bin 可执行文件]');
    return;
  }
  if (!values.server || !values.workspace || !idPattern.test(values.connection || '')) throw Error('需要 --server、--connection 和 --workspace。');
  const server = new URL(values.server);
  if (server.protocol !== 'https:' || server.username || server.password || server.pathname !== '/' || server.search || server.hash) {
    throw Error('--server 必须是 HTTPS 根地址。');
  }
  const workspace = await realpath(values.workspace);
  if (!(await stat(workspace)).isDirectory()) throw Error('--workspace 必须是目录。');
  const ca = values.ca ? await readFile(values.ca) : undefined;
  const { MuseClient } = await import('@muse-code/sdk').catch(() => { throw Error('请在连接器目录运行 npm install @muse-code/sdk@1.4.15。'); });
  const token = await pairingToken();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw Error('Voxi 配对密钥格式无效。');
  const scope = createHash('sha256').update(JSON.stringify([server.origin, values.connection, workspace])).digest('hex');
  const state = join(homedir(), '.voxi-muse-code', scope);
  await mkdir(state, { recursive: true, mode: 0o700 });

  const env = { ...process.env };
  delete env.VOXI_CONNECTOR_TOKEN;
  const endpoint = new URL('/api/muse-code/relay', server);
  let client;
  let active;
  let pending;
  let stopping = false;
  let status = 'unreachable';
  let retryHostAt = 0;
  const stop = () => {
    stopping = true;
    active?.controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('正在连接 Voxi 与 Muse Code。请保持连接器运行。');
  try {
    while (!stopping) {
      if (!client && !active && Date.now() >= retryHostAt) {
        try {
          const host = await MuseClient.spawn({
            museBin: values['muse-bin'] ? resolve(values['muse-bin']) : await windowsLauncherBinary(),
            args: ['serve'], cwd: workspace, env,
            clientInfo: { name: 'voxi_muse_code', version: '1.0.0' },
          });
          client = host;
          status = 'ready';
          host.exit.then(() => {
            if (client === host) {
              client = undefined;
              status = 'unreachable';
            }
          });
          console.log('Muse Code SDK 握手成功。');
        } catch {
          retryHostAt = Date.now() + 15000;
          console.error('Muse Code 未能启动。请检查 Muse CLI 安装、版本和主机权限。');
        }
      }
      const body = { connectionId: values.connection, status, op: pending ? 'result' : 'poll', busy: Boolean(active), taskId: active?.id, ...pending };
      try {
        const data = await relay(endpoint, token, ca, body);
        if (pending && body.op === 'result' && data.ok) {
          console.log('任务结果已送达。');
          pending = undefined;
          active = undefined;
        } else if (active && data.stop === active.id) {
          active.controller.abort();
        } else if (!active && data.job) {
          const job = data.job;
          const controller = new AbortController();
          active = { id: job.id, controller };
          console.log('已接收 Voxi 任务。');
          const duration = Number.isSafeInteger(job.timeout) ? Math.min(7200, Math.max(1, job.timeout)) : 1800;
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(duration * 1000)]);
          const work = client ? executeMuse(client, job, workspace, state, signal)
            : Promise.resolve({ state: 'failed', result: 'Muse Code 在接收任务时已断开。' });
          void work.then(result => { pending = result; });
        }
      } catch {
        console.error('Voxi 未确认连接或结果，稍后重试传送。不会重新执行任务。');
      }
      await sleep(2000);
    }
  } finally {
    await client?.close();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
