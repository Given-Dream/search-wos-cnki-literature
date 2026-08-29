import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';
import { loadChromium } from './lib/playwright.mjs';
import { normalizeDatabaseQuery, parseWosResultCount } from './lib/retrieval.mjs';

const usage = 'Usage: node scripts/wos_collect.mjs --query-file <path> --output <txt> [--meta-output <json>] [--limit 200] --label <GROUP_ID>';
const args = parseArgs(process.argv.slice(2));
requireArgs(args, ['query-file', 'output'], usage);

const originalQuery = (await fs.readFile(String(args['query-file']), 'utf8')).trim();
const query = normalizeDatabaseQuery(originalQuery, 'WOS');
const limit = Math.max(1, Math.min(1000, Number(args.limit ?? 200)));
const debuggerUrl = String(args['debugger-url'] ?? 'http://127.0.0.1:9333');
const advancedSearchUrl = String(args.url ?? 'https://webofscience.clarivate.cn/wos/woscc/advanced-search');
await fs.mkdir(path.dirname(path.resolve(String(args.output))), { recursive: true });

const chromium = await loadChromium();
const browser = await chromium.connectOverCDP(debuggerUrl);
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error('No Edge context is available. Start edge_session.mjs first.');
  let page = context.pages().find((candidate) => /webofscience|clarivate\.cn/i.test(candidate.url()));
  if (!page) page = await context.newPage();

  await page.goto(advancedSearchUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const queryBox = page.locator('#advancedSearchInputArea');
  await queryBox.waitFor({ state: 'visible', timeout: 60_000 });
  const acceptCookies = page.locator('#onetrust-accept-btn-handler');
  if (await acceptCookies.isVisible().catch(() => false)) await acceptCookies.click({ force: true });
  await queryBox.fill(query);
  const searchButton = page.locator('button[data-ta="run-search"]');
  if (await searchButton.count()) {
    await searchButton.last().click();
  } else {
    await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  }
  await page.waitForURL(/\/wos\/woscc\/summary\//, { timeout: 90_000 });
  await page.waitForTimeout(5_000);

  const bodyText = await page.locator('body').innerText();
  const parsedCount = parseWosResultCount(bodyText);
  const resultCount = parsedCount ?? 0;
  const explicitZero = /(?:0\s+results from Web of Science Core Collection|0\s+records matched your query)/i.test(bodyText);
  const meta = {
    label: String(args.label ?? ''),
    database: 'WOS',
    queryFile: path.resolve(String(args['query-file'])),
    query,
    queryWasNormalized: query !== originalQuery,
    resultCount,
    status: resultCount > 0 ? 'results' : (explicitZero ? 'confirmed-empty' : 'count-unreadable'),
    collectedAt: new Date().toISOString(),
    resultUrl: page.url(),
    pageTitle: await page.title(),
  };
  if (args['meta-output']) {
    await fs.mkdir(path.dirname(path.resolve(String(args['meta-output']))), { recursive: true });
    await fs.writeFile(String(args['meta-output']), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
  if (!resultCount) {
    if (explicitZero) {
      throw new Error('WOS confirmed zero records. Apply the counted-block diagnostic in references/query-workflow.md before changing required concepts.');
    }
    throw new Error('WOS result count could not be read. Treat this as a collection/UI-state failure, not a zero-result query.');
  }

  const exportCount = Math.min(limit, resultCount);
  await page.locator('#export-trigger-btn').click({ timeout: 30_000 });
  const fieldTaggedTrigger = page.locator('#exportToFieldTaggedButton');
  if (await fieldTaggedTrigger.count()) await fieldTaggedTrigger.click({ timeout: 30_000 });

  const exportWindow = page.locator('div.window-content').last();
  await exportWindow.waitFor({ state: 'visible', timeout: 30_000 });
  const rangeRadio = exportWindow.locator('input[name="outputMethodType"][value="fromRange"]');
  if (await rangeRadio.count()) await rangeRadio.click();
  const markFrom = exportWindow.locator('input[name="markFrom"]');
  const markTo = exportWindow.locator('input[name="markTo"]');
  if (await markFrom.count()) await markFrom.fill('1');
  if (await markTo.count()) await markTo.fill(String(exportCount));

  const contentSelect = exportWindow.getByRole('combobox');
  if (await contentSelect.count()) {
    await contentSelect.last().click();
    const fullRecordOption = page.locator('[role="option"][data-ta="Full Record"]');
    if (await fullRecordOption.count()) {
      await fullRecordOption.last().click();
    } else {
      await page.getByRole('option', { name: /Full Record/i }).last().click();
    }
  } else {
    await page.locator('#option-fullRecord').click();
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  const exportButton = exportWindow.locator('#exportButton');
  if (await exportButton.count()) {
    await exportButton.click();
  } else {
    await page.locator('#exportOptionButton').click();
  }
  const download = await downloadPromise;
  await download.saveAs(String(args.output));

  const completed = {
    ...meta,
    exportedRecords: exportCount,
    output: path.resolve(String(args.output)),
    suggestedFilename: download.suggestedFilename(),
  };
  if (args['meta-output']) await fs.writeFile(String(args['meta-output']), `${JSON.stringify(completed, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(completed, null, 2));
} finally {
  await browser.close();
}
