import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeMuse } from './voxi-muse-code.mjs';

test('Muse runs a native SDK turn, resumes only mapped sessions, and reports actual terminal outcomes', async t => {
  const state = await mkdtemp(join(tmpdir(), 'voxi-muse-'));
  t.after(() => rm(state, { recursive: true, force: true }));
  const calls = [];
  const session = {
    sessionId: 'native-session',
    setApprovalMode: async mode => calls.push(mode),
    run: async (text, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      calls.push(text);
      return { outcome: { kind: 'completed', params: { terminal: 'completed' } }, finalText: 'Reviewed',
        usage: { inputTokens: 4, outputTokens: 5 } };
    },
    leave: async () => calls.push('leave'),
  };
  const client = {
    startSession: async options => { calls.push(options); return session; },
    resumeSession: async options => { calls.push(options); return session; },
  };
  const signal = new AbortController().signal;
  const job = { id: 'a'.repeat(32), session: 'voxi-' + 'b'.repeat(32) + '-' + 'a'.repeat(32), text: 'Review this' };
  const workspace = join(state, 'project');
  assert.equal((await executeMuse(client, { ...job, resume: true }, workspace, state, signal)).state, 'failed');
  assert.deepEqual(calls, []);
  assert.deepEqual(await executeMuse(client, job, workspace, state, signal), {
    state: 'completed', result: 'Reviewed', usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
  });
  assert.deepEqual(calls, [{ workspaceRoot: workspace, approvalMode: 'denyUnmatched' }, 'Review this', 'leave']);
  session.run = async () => ({ outcome: { kind: 'terminalUnknown' } });
  assert.equal((await executeMuse(client, { ...job, resume: true }, workspace, state, signal)).state, 'delivery_unknown');
  assert.deepEqual(calls.slice(-3), [{ sessionId: 'native-session' }, 'denyUnmatched', 'leave']);
});
