import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/cli.mjs';
import { loadChromium } from './lib/playwright.mjs';
import { buildDatabaseTarget, loadDatabaseCatalog, parseDatabaseSelection } from './lib/database-catalog.mjs';
import { classifyAccessPage, normalizeLoopbackCdpUrl } from './lib/browser-session.mjs';

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

async function inspectDatabase(createPage, database, timeoutMs, query, queryType) {
  const target = query
    ? buildDatabaseTarget(database, query, { queryType })
    : { url: database.whlibUrl || database.launchUrl, queryApplied: false };
  const requestedUrl = target.url;
  const startedAt = Date.now();
  const page = await createPage();
  try {
    const response = await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(1_000);
    const finalUrl = page.url();
    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
    const status = response?.status() ?? null;
    const state = classifyAccessPage({ status, finalUrl, title, bodyText: bodyText.slice(0, 8_000) });
    const requestedHost = new URL(requestedUrl).hostname;
    const finalHost = /^https?:/i.test(finalUrl) ? new URL(finalUrl).hostname : '';
    return {
      number: database.number,
      id: database.id,
      label: database.label,
      requestedUrl,
      queryApplied: target.queryApplied,
      finalUrl,
      finalHost,
      title,
      httpStatus: status,
      state,
      landingReachable: state === 'landing-reachable' || state === 'authentication-required',
      entryPointReached: ['landing-reachable', 'authentication-required', 'verification-required', 'automation-restricted'].includes(state),
      manualBrowserCheckRecommended: state === 'automation-restricted',
      redirected: Boolean(finalHost && requestedHost !== finalHost),
      elapsedMs: Date.now() - startedAt,
      institutionalFullTextVerified: false,
      note: state === 'automation-restricted'
        ? 'The normal Edge session was restricted. This is not proof that the site is unavailable; do not bypass the gate.'
        : 'Landing-page navigation only; this result does not prove subscription or full-text entitlement.',
    };
  } catch (error) {
    const message = String(error?.message ?? error).replace(/\s+/g, ' ').trim();
    const state = /timeout/i.test(message) ? 'timeout' : 'navigation-failed';
    return {
      number: database.number,
      id: database.id,
      label: database.label,
      requestedUrl,
      queryApplied: target.queryApplied,
      finalUrl: page.url(),
      finalHost: '',
      title: '',
      httpStatus: null,
      state,
      landingReachable: false,
      entryPointReached: false,
      redirected: false,
      elapsedMs: Date.now() - startedAt,
      error: message.slice(0, 1_500),
      institutionalFullTextVerified: false,
      note: 'Landing-page navigation only; this result does not prove subscription or full-text entitlement.',
    };
  } finally {
    await page.close().catch(() => {});
  }
}

const usage = 'Usage: node scripts/test_database_access.mjs --all|--selection <numbers-or-ids> --output <json> [--debugger-url <existing-native-Edge-CDP>] [--boolean-query <site-specific-expression>|--keyword-query <text>] [--timeout-ms 30000] [--concurrency 1]';
const args = parseArgs(process.argv.slice(2));
if (!args.all && args.selection === undefined) throw new Error(usage);
if (!args.output) throw new Error(usage);

const catalog = await loadDatabaseCatalog(args.catalog);
const databases = args.all ? catalog.databases : parseDatabaseSelection(args.selection, catalog);
const timeoutMs = boundedInteger(args['timeout-ms'], 30_000, 5_000, 120_000);
const concurrency = boundedInteger(args.concurrency, 1, 1, 6);
if (args.headless !== undefined) throw new Error('Headless Edge is disabled. Start the ordinary visible Edge session first.');
if (args.query !== undefined) {
  throw new Error('Generic --query is disabled. Use --boolean-query or --keyword-query for one selected database.');
}
const booleanQuery = String(args['boolean-query'] ?? '').trim().replace(/\s+/gu, ' ');
const keywordQuery = String(args['keyword-query'] ?? '').trim().replace(/\s+/gu, ' ');
if (booleanQuery && keywordQuery) throw new Error('Use either --boolean-query or --keyword-query, not both.');
const query = booleanQuery || keywordQuery;
const queryType = booleanQuery ? 'boolean' : (keywordQuery ? 'keyword' : 'none');
if (query && databases.length !== 1) {
  throw new Error('Query passage testing is database-specific; select exactly one database.');
}
const edgePath = path.resolve(String(args['edge-path'] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'));
if (!fsSync.existsSync(edgePath)) throw new Error(`Microsoft Edge was not found at: ${edgePath}`);

const chromium = await loadChromium();
const debuggerUrl = normalizeLoopbackCdpUrl(args['debugger-url']);
const visibilityCheck = spawnSync(process.execPath, [fileURLToPath(new URL('./start_edge_cdp.mjs', import.meta.url)), '--port', new URL(debuggerUrl).port || '80', '--edge-path', edgePath, '--connect-only', 'true'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
if (visibilityCheck.error || visibilityCheck.status !== 0) throw new Error(`Ordinary Edge window is not ready: ${visibilityCheck.error?.message || visibilityCheck.stderr.trim()}`);
const nativeEvidence = JSON.parse(visibilityCheck.stdout.trim());
if (!nativeEvidence.ready) throw new Error('No visible native Edge window was confirmed.');
const browser = await chromium.connectOverCDP(debuggerUrl);

const results = new Array(databases.length);
let cursor = 0;
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error('No context in the existing native Edge session.');
  const cdp = await browser.newBrowserCDPSession();
  let creationTail = Promise.resolve();
  function createPage() {
    const creation = creationTail.then(async () => {
      const created = context.waitForEvent('page');
      await cdp.send('Target.createTarget', { url: 'about:blank', background: true });
      return created;
    });
    creationTail = creation.catch(() => {});
    return creation;
  }
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= databases.length) return;
      const database = databases[index];
      const result = await inspectDatabase(createPage, database, timeoutMs, query, queryType);
      results[index] = result;
      console.log(`TEST ${index + 1}/${databases.length} ${database.id}: ${result.state} -> ${result.finalUrl || result.requestedUrl}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, databases.length) }, () => worker()));
} finally {
  await browser.close().catch(() => {});
}

const summary = results.reduce((counts, result) => {
  counts[result.state] = (counts[result.state] ?? 0) + 1;
  return counts;
}, {});
const report = {
  schemaVersion: 1,
  testedAt: new Date().toISOString(),
  method: 'Existing verified native Microsoft Edge window, background tabs, no automated login or access-control bypass.',
  scope: 'Landing-page reachability only. Full-text entitlement is not tested.',
  query,
  queryType,
  catalogSource: catalog.source,
  headless: false,
  nativeWindow: nativeEvidence.nativeWindow,
  timeoutMs,
  concurrency,
  summary,
  results,
};

const outputPath = path.resolve(String(args.output));
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: outputPath, summary }, null, 2));

if (args.strict && results.some((result) => !result.landingReachable)) process.exitCode = 2;
