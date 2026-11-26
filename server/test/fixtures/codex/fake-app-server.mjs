// Stands in for `codex app-server`: newline-delimited JSON-RPC on stdio, replaying a recorded result.
// Usage: node fake-app-server.mjs <mode> [result.json]
// Modes: ok, error-32600, echo-home (answers with an error naming CODEX_HOME), exit-early, hang.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [mode, resultFile] = process.argv.slice(2);
if (mode === 'exit-early') process.exit(3);

let initializeAnswered = false;
let initialized = false;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (mode === 'hang') return;
  if (msg.method === 'initialize') {
    setTimeout(() => {
      initializeAnswered = true;
      send({ id: msg.id, result: { userAgent: 'fake' } });
      // The real server sends notifications between responses.
      send({ method: 'remoteControl/status/changed', params: { status: 'disabled' } });
    }, 20);
  } else if (msg.method === 'initialized') {
    if (!initializeAnswered) send({ id: null, error: { code: -32600, message: 'initialized before initialize result' } });
    initialized = true;
  } else if (msg.method === 'account/rateLimits/read') {
    if (!initialized) return send({ id: msg.id, error: { code: -32002, message: 'Not initialized' } });
    if (msg.params?.excludeResetCreditDetails !== true) return send({ id: msg.id, error: { code: -32602, message: 'expected excludeResetCreditDetails' } });
    if (mode === 'echo-home') return send({ id: msg.id, error: { code: -32600, message: `CODEX_HOME=${process.env.CODEX_HOME}` } });
    if (mode === 'error-32600') return send({ id: msg.id, error: { code: -32600, message: 'codex account authentication required to read rate limits' } });
    send({ id: msg.id, result: JSON.parse(readFileSync(resultFile, 'utf8')) });
  }
});
