import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';
import { loadChromium } from './lib/playwright.mjs';

const usage = 'Usage: node scripts/wos_collect.mjs --query-file <path> --output <txt> [--meta-output <json>] [--limit 200] --label <GROUP_ID>';
const args = parseArgs(process.argv.slice(2));
requireArgs(args, ['query-file', 'output'], usage);

const query = (await fs.readFile(String(args['query-file']), 'utf8')).trim();
if (!query) throw new Error('The WOS query file is empty.');
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
  await page.getByRole('button', { name: 'Search', exact: true }).last().click();
  await page.waitForURL(/\/wos\/woscc\/summary\//, { timeout: 90_000 });
  await page.waitForTimeout(5_000);

  const bodyText = await page.locator('body').innerText();
  const countMatch = bodyText.match(/([\d,]+)\s+results from Web of Science Core Collection/i)
    ?? bodyText.match(/([\d,]+)\s+records matched your query/i);
  const resultCount = countMatch ? Number(countMatch[1].replaceAll(',', '')) : 0;
  const meta = {
    label: String(args.label ?? ''),
    database: 'WOS',
    queryFile: path.resolve(String(args['query-file'])),
    query,
    resultCount,
    collectedAt: new Date().toISOString(),
    resultUrl: page.url(),
    pageTitle: await page.title(),
  };
  if (args['meta-output']) {
    await fs.mkdir(path.dirname(path.resolve(String(args['meta-output']))), { recursive: true });
    await fs.writeFile(String(args['meta-output']), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  }
  if (!resultCount) {
    throw new Error('WOS returned zero records or its count could not be read. Apply the block-count diagnostic in references/query-logic.md.');
  }

  const exportCount = Math.min(limit, resultCount);
  await page.locator('#export-trigger-btn').click({ timeout: 30_000 });
  await page.locator('#exportToFieldTaggedButton').click({ timeout: 30_000 });
  await page.locator('input[name="outputMethodType"][value="fromRange"]').click();
  await page.locator('input[name="markFrom"]').fill('1');
  await page.locator('input[name="markTo"]').fill(String(exportCount));
  await page.locator('button[data-ta="Author, Title, Source"]').click();
  await page.locator('#option-fullRecord').click();

  const downloadPromise = page.waitForEvent('download', { timeout: 90_000 });
  await page.locator('#exportOptionButton').click();
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
