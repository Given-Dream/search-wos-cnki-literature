import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { buildExternalEdgeArgs, classifyNativeEdgeWindow, normalizeLoopbackCdpUrl, validateBrowserTarget } from './lib/browser-session.mjs';
import { loadChromium } from './lib/playwright.mjs';

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
if (args.headless !== undefined) throw new Error('Headless Edge is disabled. Use a normal visible Edge desktop window.');
if (args.help) {
  console.log(usage);
  process.exit(0);
}

const edgePath = path.resolve(String(args['edge-path'] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'));
const profileDir = path.resolve(String(args['profile-dir'] ?? '.edge-literature-profile'));
const port = boundedInteger(args.port, 9333, 1024, 65535);
const timeoutMs = boundedInteger(args['timeout-ms'], 30_000, 2_000, 120_000);
const allowInsecureHttp = parseBoolean(args['allow-insecure-http'], false);
const startUrl = validateBrowserTarget(String(args['start-url'] ?? 'about:blank'), {
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
    launchMethod: 'Windows-Start-Process-Normal',
    requireNativeWindowVisibility: true,
    userVerificationSurface: 'ordinary-Edge-desktop-window',
    localRelayPanelAllowed: false,
  }, null, 2));
  process.exit(0);
}

if (process.platform !== 'win32') throw new Error('This native Edge launcher requires an interactive Windows desktop.');
if (!fs.existsSync(edgePath)) throw new Error(`Microsoft Edge was not found at: ${edgePath}`);
const nativeHelper = fileURLToPath(new URL('./edge_native_window.ps1', import.meta.url));
function runNativeHelper(extraArgs = [], input) {
  const inspectionPid = extraArgs.length ? Number(extraArgs[1]) : 0;
  if (extraArgs.length && (!Number.isInteger(inspectionPid) || inspectionPid <= 0)) throw new Error('Invalid native Edge process PID.');
  // Execute only this bundled helper as inline code; never change the machine's script execution policy.
  // Launch URLs and paths remain JSON data on stdin, not PowerShell command text.
  const code = `& {\n${fs.readFileSync(nativeHelper, 'utf8')}\n} ${inspectionPid ? `-InspectProcessId ${inspectionPid}` : ''}`;
  const encoded = Buffer.from(code, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input, encoding: 'utf8', windowsHide: true, timeout: 15_000,
  });
  if (result.error || result.status !== 0) throw new Error(`Native Edge window operation failed: ${result.error?.message || result.stderr.trim()}`);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
}

const existingEndpoint = await inspectCdpEndpoint(debuggerUrl);
let childPid = null;
let status = 'already-running';
if (!existingEndpoint) {
  if (parseBoolean(args['connect-only'], false)) throw new Error('No existing Edge session is available. Open the ordinary Edge window first.');
  childPid = runNativeHelper([], JSON.stringify({ edgePath, edgeArgs })).childPid;
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

const endpoint = await inspectCdpEndpoint(debuggerUrl);
let nativeWindow = {};
try {
  const browser = await (await loadChromium()).connectOverCDP(debuggerUrl);
  try {
    const cdp = await browser.newBrowserCDPSession();
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const browserProcessId = processInfo.find(item => item.type === 'browser')?.id;
    if (!browserProcessId) throw new Error('No native browser process PID was reported.');
    nativeWindow = runNativeHelper(['-InspectProcessId', String(browserProcessId)]);
  } finally { await browser.close(); }
} catch (error) {
  nativeWindow = { visible: false, error: String(error.message).split('\n')[0] };
}
const visibility = classifyNativeEdgeWindow({ browserVersion: endpoint?.Browser, userAgent: endpoint?.['User-Agent'], nativeWindow });
if (visibility !== 'visible-native-window') {
  console.log(JSON.stringify({ status: 'native-window-unconfirmed', visibility, nativeWindow, ready: false, localRelayPanelAllowed: false }));
  throw new Error('Cannot confirm a visible native Edge desktop window. Repair the native Windows launch in the interactive desktop and retry. Do not replace it with a localhost panel or headless browser.');
}

console.log(JSON.stringify({
  status,
  browser: 'Microsoft Edge',
  childPid,
  debuggerUrl,
  profileDir,
  startUrl,
  ready: true,
  visibility,
  nativeWindow,
  launchMethod: 'Windows-Start-Process-Normal',
  localRelayPanelAllowed: false,
  note: '普通 Edge 窗口已打开并保持运行。请在该原生窗口手动完成登录、机构认证、Cookie 同意或验证码；无需访问本地端口面板。',
}, null, 2));
