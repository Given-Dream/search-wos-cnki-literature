import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from './lib/cli.mjs';
import { buildExternalEdgeArgs, normalizeLoopbackCdpUrl, validateBrowserTarget } from './lib/browser-session.mjs';

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  if (/^(?:1|true|yes|on|是)$/iu.test(String(value))) return true;
  if (/^(?:0|false|no|off|否)$/iu.test(String(value))) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

async function inspectCdpEndpoint(cdpUrl, timeoutMs = 2_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${cdpUrl}/json/version`, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.webSocketDebuggerUrl ? payload : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const usage = 'Usage: node scripts/start_edge_cdp.mjs [--profile-dir <dir>] [--port 9333] [--start-url <url>] [--dry-run true]';
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage);
  process.exit(0);
}

const edgePath = path.resolve(String(args['edge-path'] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'));
const profileDir = path.resolve(String(args['profile-dir'] ?? '.edge-literature-profile'));
const port = boundedInteger(args.port, 9333, 1024, 65535);
const timeoutMs = boundedInteger(args['timeout-ms'], 30_000, 2_000, 120_000);
const allowInsecureHttp = parseBoolean(args['allow-insecure-http'], false);
const startUrl = validateBrowserTarget(String(args['start-url'] ?? 'https://qikan.cqvip.com/'), {
  allowInsecureHttp,
  field: 'Edge start URL',
});
const debuggerUrl = normalizeLoopbackCdpUrl(`http://127.0.0.1:${port}`);
const edgeArgs = buildExternalEdgeArgs({ profileDir, port, startUrls: [startUrl], allowInsecureHttp });

if (parseBoolean(args['dry-run'], false)) {
  console.log(JSON.stringify({
    status: 'dry-run',
    browser: 'Microsoft Edge',
    edgePath,
    debuggerUrl,
    profileDir,
    startUrl,
    args: edgeArgs,
  }, null, 2));
  process.exit(0);
}

if (!fs.existsSync(edgePath)) throw new Error(`Microsoft Edge was not found at: ${edgePath}`);

const existingEndpoint = await inspectCdpEndpoint(debuggerUrl);
let childPid = null;
let status = 'already-running';
if (!existingEndpoint) {
  const child = spawn(edgePath, edgeArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  childPid = child.pid ?? null;
  child.unref();
  status = 'started';

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await inspectCdpEndpoint(debuggerUrl)) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!await inspectCdpEndpoint(debuggerUrl)) {
    throw new Error(`Edge started but the local CDP endpoint did not become ready: ${debuggerUrl}`);
  }
}

console.log(JSON.stringify({
  status,
  browser: 'Microsoft Edge',
  childPid,
  debuggerUrl,
  profileDir,
  startUrl,
  note: 'Use the visible Edge window. Complete login, institutional authentication, consent, or CAPTCHA manually; do not export browser secrets.',
}, null, 2));
