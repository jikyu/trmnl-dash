import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/process.ts';

test('a run past its timeout is killed and fails', async () => {
  const started = Date.now();
  await assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 }), /did not finish/);
  assert.ok(Date.now() - started < 2000);
});

test('a run returns its exit code and output, with stdin closed', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdin.on("end", () => { console.log("eof"); process.exit(3) }); process.stdin.resume()'], { timeoutMs: 5000 });
  assert.deepEqual(result, { code: 3, stdout: 'eof\n', stderr: '' });
});
