import { parseArgs } from './lib/cli.mjs';
import { classifyCqvipPage, normalizeLoopbackCdpUrl } from './lib/browser-session.mjs';
import { looksLikeBooleanExpression, normalizeCatalogQuery } from './lib/database-catalog.mjs';
import { loadChromium } from './lib/playwright.mjs';

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

async function firstVisible(locators) {
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return null;
}

async function snapshot(page) {
  const searchInput = await firstVisible([
    page.getByPlaceholder('请输入检索词', { exact: false }),
    page.locator('input[placeholder*="检索词"]'),
  ]);
  const title = await page.title().catch(() => '');
  const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  const finalUrl = page.url();
  return {
    finalUrl,
    title,
    bodyText: bodyText.slice(0, 8_000),
    searchInput,
    state: classifyCqvipPage({
      finalUrl,
      title,
      bodyText: bodyText.slice(0, 8_000),
      searchInputVisible: Boolean(searchInput),
    }),
  };
}

const usage = 'Usage: node scripts/cqvip_search.mjs [--debugger-url http://127.0.0.1:9333] [--boolean-query <CQVIP-expression>]';
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage);
  process.exit(0);
}
if (args.query !== undefined) {
  throw new Error('CQVIP supports Boolean expressions. Generic --query is disabled; use --boolean-query with the CQVIP dialect.');
}

const debuggerUrl = normalizeLoopbackCdpUrl(args['debugger-url'] ?? 'http://127.0.0.1:9333');
const query = normalizeCatalogQuery(args['boolean-query'] ?? '');
if (query && !looksLikeBooleanExpression(query)) {
  throw new Error('CQVIP Boolean search requires an explicit AND, OR, NOT, +, or * operator.');
}
const timeoutMs = boundedInteger(args['timeout-ms'], 30_000, 5_000, 120_000);
const chromium = await loadChromium();
const browser = await chromium.connectOverCDP(debuggerUrl);

try {
  const context = browser.contexts()[0];
  if (!context) throw new Error('No Edge context is available. Start scripts/start_edge_cdp.mjs first.');
  let page = context.pages().filter((candidate) => {
    try { return new URL(candidate.url()).hostname === 'qikan.cqvip.com'; } catch { return false; }
  }).at(-1);
  if (!page) {
    page = await context.newPage();
    await page.goto('https://qikan.cqvip.com/', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  }
  await page.bringToFront();

  let current = await snapshot(page);
  const baseResult = {
    database: 'cqvip',
    debuggerUrl,
    pageUrl: current.finalUrl,
    pageTitle: current.title,
    state: current.state,
    querySubmitted: false,
    queryType: query ? 'boolean' : 'none',
    queryDialect: 'CQVIP AND / OR / NOT (also * / + / -), parentheses, and double quotes',
    note: 'No cookies, tokens, passwords, or browser storage were read.',
  };

  if (current.state !== 'ready') {
    console.log(JSON.stringify({
      ...baseResult,
      action: current.state === 'manual-action-required'
        ? 'Complete the visible login or verification step in Edge, then rerun this command.'
        : 'Keep the visible Edge window open. Do not retry aggressively or bypass the site restriction.',
    }, null, 2));
    process.exitCode = 2;
  } else if (!query) {
    console.log(JSON.stringify({ ...baseResult, action: 'ready-for-query' }, null, 2));
  } else {
    await current.searchInput.fill(query, { timeout: timeoutMs });
    const submitControl = await firstVisible([
      page.locator('div.search-btn').filter({ hasText: /^\s*检索\s*$/u }),
      page.locator('button#btnSearch'),
      page.getByRole('button', { name: '检索', exact: true }),
      page.locator('input[type="submit"][value="检索"], input[type="button"][value="检索"]'),
      page.locator('[role="button"]').filter({ hasText: /^检索$/u }),
      page.locator('a').filter({ hasText: /^检索$/u }),
    ]);
    if (!submitControl) throw new Error('CQVIP search control is not visible. Complete any manual gate and rerun.');

    await submitControl.click({ timeout: timeoutMs });
    await Promise.race([
      page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeoutMs, 15_000) }),
      page.waitForTimeout(2_500),
    ]).catch(() => {});
    current = await snapshot(page);
    console.log(JSON.stringify({
      ...baseResult,
      pageUrl: current.finalUrl,
      pageTitle: current.title,
      state: 'submitted',
      querySubmitted: true,
      queryType: 'boolean',
      query,
      postSubmitState: current.state,
    }, null, 2));
  }
} finally {
  await browser.close().catch(() => {});
}
