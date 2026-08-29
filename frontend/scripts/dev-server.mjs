#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, '..');

await mkdir(resolve(frontendDir, '.next', 'static', 'development'), { recursive: true });

const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'dev', ...process.argv.slice(2)], {
  cwd: frontendDir,
  env: process.env,
  detached: true,
  stdio: 'inherit',
});

let shuttingDown = false;
const signalExitCodes = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

function signalChild(signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    shuttingDown = true;
    signalChild(signal);
    const timer = setTimeout(() => {
      signalChild('SIGKILL');
      process.exit(signalExitCodes[signal] ?? 1);
    }, 8000);
    timer.unref();
  });
}

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(signalExitCodes[signal] ?? 1);
    return;
  }

  process.exit(code ?? (shuttingDown ? 0 : 1));
});
