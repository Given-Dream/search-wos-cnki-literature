import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { loadChromium } from './lib/playwright.mjs';
import { normalizeLoopbackCdpUrl, validateBrowserTarget } from './lib/browser-session.mjs';

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  if (/^(?:1|true|yes|on|是)$/iu.test(String(value))) return true;
  if (/^(?:0|false|no|off|否)$/iu.test(String(value))) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.headless !== undefined) throw new Error('Headless Edge is disabled. Use a normal visible Edge desktop window.');
const edgePath = String(args['edge-path'] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const profileDir = path.resolve(String(args['profile-dir'] ?? '.edge-wos-cnki-profile'));
const port = Number(args.port ?? 9333);
const startUrl = String(args['start-url'] ?? 'about:blank');
const planPath = args.plan ? path.resolve(String(args.plan)) : '';
const connectOverCdp = args['connect-over-cdp']
  ? normalizeLoopbackCdpUrl(args['connect-over-cdp'])
  : '';

if (!connectOverCdp && !fs.existsSync(edgePath)) throw new Error(`Microsoft Edge was not found at: ${edgePath}`);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid CDP port: ${port}`);

let plannedTargets = [];
if (planPath) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (!Array.isArray(plan.databases) || !plan.databases.length) {
    throw new Error(`Database selection plan contains no databases: ${planPath}`);
  }
  plannedTargets = plan.databases.map((database) => {
    const targetUrl = String(database.targetUrl ?? database.launchUrl ?? '');
    validateBrowserTarget(targetUrl, {
      allowInsecureHttp: Boolean(database.allowInsecureHttp),
      field: `database target for ${database.id ?? database.number ?? 'unknown'}`,
    });
    return {
      number: database.number,
      id: String(database.id ?? ''),
      label: String(database.label ?? database.id ?? ''),
      retrievalMode: String(database.retrievalMode ?? ''),
      queryCapability: String(database.queryCapability ?? ''),
      booleanSubmission: String(database.booleanSubmission ?? ''),
      queryDialect: String(database.queryDialect ?? ''),
      queryType: String(database.queryType ?? 'none'),
      queryInputMode: String(database.queryInputMode ?? 'none'),
      queryApplied: Boolean(database.queryApplied),
      queryPending: Boolean(database.queryPending),
      allowInsecureHttp: Boolean(database.allowInsecureHttp),
      targetUrl,
    };
  });
}

const chromium = await loadChromium();
let browser = null;
let context;
let sessionMode;
const nativeLaunchArgs = [fileURLToPath(new URL('./start_edge_cdp.mjs', import.meta.url)), '--edge-path', edgePath, '--profile-dir', profileDir];
if (connectOverCdp) {
  nativeLaunchArgs.push('--port', new URL(connectOverCdp).port || '80', '--connect-only', 'true');
} else {
  const firstTarget = plannedTargets[0];
  nativeLaunchArgs.push('--port', String(port), '--start-url', firstTarget?.targetUrl || startUrl);
  if (firstTarget?.allowInsecureHttp || parseBoolean(args['allow-insecure-http'], false)) nativeLaunchArgs.push('--allow-insecure-http', 'true');
}
const nativeResult = spawnSync(process.execPath, nativeLaunchArgs, { encoding: 'utf8', windowsHide: true, timeout: 150_000 });
if (nativeResult.error || nativeResult.status !== 0) throw new Error(`Ordinary Edge window is not ready: ${nativeResult.error?.message || nativeResult.stderr.trim()}`);
const nativeEvidence = JSON.parse(nativeResult.stdout.replace(/^\uFEFF/, '').trim());
if (!nativeEvidence.ready) throw new Error('Native Edge visibility was not confirmed. No database pages were opened by this session.');
if (connectOverCdp) {
  browser = await chromium.connectOverCDP(connectOverCdp);
  context = browser.contexts()[0];
  if (!context) throw new Error(`No Edge context is available at ${connectOverCdp}.`);
  sessionMode = 'connect-over-cdp';
} else {
  browser = await chromium.connectOverCDP(nativeEvidence.debuggerUrl);
  context = browser.contexts()[0];
  if (!context) throw new Error('No context is available in the ordinary Edge window.');
  sessionMode = 'native-edge-desktop';
}

const targets = plannedTargets.length
  ? plannedTargets
  : [{
    number: null,
    id: '',
    label: 'start-url',
    retrievalMode: '',
    queryCapability: '',
    booleanSubmission: '',
    queryDialect: '',
    queryType: 'none',
    queryInputMode: 'none',
    queryApplied: false,
    queryPending: false,
    allowInsecureHttp: parseBoolean(args['allow-insecure-http'], false),
    targetUrl: validateBrowserTarget(startUrl, {
      allowInsecureHttp: parseBoolean(args['allow-insecure-http'], false),
      field: 'start URL',
    }),
  }];
const openedPages = [];
for (let index = 0; index < targets.length; index += 1) {
  const target = targets[index];
  const targetHost = target.targetUrl === 'about:blank' ? '' : new URL(target.targetUrl).hostname;
  const pages = context.pages();
  const exactPage = pages.find((candidate) => candidate.url() === target.targetUrl);
  const sameHostPage = targetHost
    ? pages.find((candidate) => {
      try { return new URL(candidate.url()).hostname === targetHost; } catch { return false; }
    })
    : null;
  const page = exactPage
    ?? sameHostPage
    ?? (index === 0 && pages[0]?.url() === 'about:blank' ? pages[0] : await context.newPage());
  let navigationError = '';
  const pageAlreadyOnTargetHost = targetHost && (() => {
    try { return new URL(page.url()).hostname === targetHost; } catch { return false; }
  })();
  if (target.targetUrl !== 'about:blank' && page.url() !== target.targetUrl && !pageAlreadyOnTargetHost) {
    await page.goto(target.targetUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      .catch((error) => { navigationError = String(error?.message ?? error); });
  }
  openedPages.push({
    ...target,
    pageUrl: page.url(),
    pageTitle: await page.title().catch(() => ''),
    navigationError,
  });
}

console.log(JSON.stringify({
  status: 'ready',
  browser: 'Microsoft Edge',
  sessionMode,
  debuggerUrl: connectOverCdp || `http://127.0.0.1:${port}`,
  profileDir: connectOverCdp ? null : profileDir,
  planPath,
  pages: openedPages,
  visibility: nativeEvidence.visibility,
  nativeWindow: nativeEvidence.nativeWindow,
  localRelayPanelAllowed: false,
  note: '普通 Edge 窗口已打开并保持运行。所有手动验证均在该原生窗口完成；确认后使用同一会话后台检索。',
}, null, 2));

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  if (browser) await browser.close().catch(() => {});
  else await context.close().catch(() => {});
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
await new Promise((resolve) => {
  if (browser) browser.once('disconnected', resolve);
  else context.once('close', resolve);
});

