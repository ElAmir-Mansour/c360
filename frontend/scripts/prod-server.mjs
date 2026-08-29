#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, '..');

// Blue-green zero-downtime deploys: which build directory is live is recorded in
// `.active-dist` (a tiny marker written atomically by the deploy at cut-over).
// next.config sets `distDir = NEXT_DIST_DIR || '.next'`, so the distDir NAME is
// baked through the standalone output — the internal app dir and the static-copy
// destination are both named after DIST. Default `.next` keeps legacy builds
// (no marker) working unchanged.
function activeDist() {
  try {
    const marker = resolve(frontendDir, '.active-dist');
    if (existsSync(marker)) {
      const value = readFileSync(marker, 'utf8').trim();
      if (value) return value;
    }
  } catch {
    // fall through to the default
  }
  return process.env.NEXT_DIST_DIR || '.next';
}
const DIST = activeDist();
const distDir = resolve(frontendDir, DIST);
const standaloneDir = resolve(distDir, 'standalone');
const serverPath = resolve(standaloneDir, 'server.js');

// next.config.mjs declares `output: 'standalone'`, which makes `next start`
// incompatible with the build (it would serve every /_next/static/* asset with
// HTTP 400 — unstyled page, no hydration). Detect the configured output so we
// never silently fall back to `next start` for a standalone build. If the
// config can't be read for any reason, assume standalone for this app (the safe
// default) rather than risk the broken fallback.
async function isStandaloneOutput() {
  try {
    const configUrl = pathToFileURL(resolve(frontendDir, 'next.config.mjs')).href;
    const mod = await import(configUrl);
    const config = mod?.default;
    const resolved = typeof config === 'function' ? config() : config;
    if (resolved && typeof resolved === 'object' && 'output' in resolved) {
      return resolved.output === 'standalone';
    }
  } catch {
    // fall through to the safe default
  }
  return true;
}

// When the standalone server is missing because a build is still in progress,
// poll briefly for server.js to appear before deciding. This rides out the race
// where pm2 (re)starts us a moment before `next build` finishes writing the
// standalone output.
function waitForStandaloneServer() {
  const totalWaitMs = Number(process.env.PROD_SERVER_WAIT_MS || 30000);
  const intervalMs = 1000;
  const deadline = Date.now() + totalWaitMs;
  let announced = false;
  while (!existsSync(serverPath)) {
    if (Date.now() >= deadline) {
      return false;
    }
    if (!announced) {
      console.warn(
        `[prod-server] .next/standalone/server.js not found; waiting up to ${Math.round(
          totalWaitMs / 1000,
        )}s for the build to finish...`,
      );
      announced = true;
    }
    // Synchronous sleep so we don't start anything until we have an answer.
    spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${intervalMs})`]);
  }
  return true;
}

const env = {
  ...process.env,
  NODE_ENV: 'production',
  HOSTNAME: process.env.HOSTNAME || '0.0.0.0',
  PORT: process.env.PORT || '3002',
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8092',
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'Clario 360',
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3002',
  NEXT_PUBLIC_APP_VERSION: process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0',
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || 'clario360',
  AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE || 'false',
  AUTH_COOKIE_DOMAIN: process.env.AUTH_COOKIE_DOMAIN || 'localhost',
  AUTH_COOKIE_SAMESITE: process.env.AUTH_COOKIE_SAMESITE || 'strict',
  AUTH_ACCESS_TOKEN_MAX_AGE: process.env.AUTH_ACCESS_TOKEN_MAX_AGE || '900',
  AUTH_REFRESH_TOKEN_MAX_AGE: process.env.AUTH_REFRESH_TOKEN_MAX_AGE || '604800',
};

const standaloneOutput = await isStandaloneOutput();
let hasStandalone = existsSync(serverPath);

if (!hasStandalone && standaloneOutput) {
  // Standalone build expected but server.js is absent — most likely a build is
  // still in progress. Wait briefly for it to appear instead of falling back to
  // the incompatible `next start`.
  hasStandalone = waitForStandaloneServer();

  if (!hasStandalone) {
    console.error(
      '\n[prod-server] FATAL: next.config.mjs sets `output: \'standalone\'` but ' +
        '.next/standalone/server.js does not exist.\n' +
        '[prod-server] The standalone build is missing or incomplete. Running ' +
        '`next start` against a standalone build would serve every /_next/static/* ' +
        'asset with HTTP 400 (unstyled page, no hydration), so we refuse to start.\n' +
        '[prod-server] Run `npm run build` to produce the standalone server, then ' +
        'restart. Exiting non-zero so the process manager can retry cleanly.\n',
    );
    process.exit(1);
  }
}

if (hasStandalone) {
  // Next's standalone output deliberately omits .next/static and public/ (the
  // deployment is expected to copy them), and its file tracing misses
  // monaco-editor (served via a dynamic fs path in app/monaco/vs/[...asset]).
  // Sync all three on every start so a fresh build always serves correctly.
  const ASSET_COPIES = [
    // The standalone's internal app dir is named after DIST (e.g. .next-green),
    // so static must land in standalone/<DIST>/static — not a hardcoded .next.
    [resolve(distDir, 'static'), resolve(standaloneDir, DIST, 'static')],
    [resolve(frontendDir, 'public'), resolve(standaloneDir, 'public')],
    [
      resolve(frontendDir, 'node_modules', 'monaco-editor', 'min', 'vs'),
      resolve(standaloneDir, 'node_modules', 'monaco-editor', 'min', 'vs'),
    ],
  ];
  for (const [src, dest] of ASSET_COPIES) {
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true, force: true });
    }
  }
}

const nextCliPath = resolve(frontendDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const childArgs = hasStandalone
  ? [serverPath]
  : [nextCliPath, 'start', '-p', env.PORT, '-H', env.HOSTNAME];
const childCwd = hasStandalone ? standaloneDir : frontendDir;

const child = spawn(process.execPath, childArgs, {
  cwd: childCwd,
  env,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  });
}

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
