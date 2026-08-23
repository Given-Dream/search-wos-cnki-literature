import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';
import { loadChromium } from './lib/playwright.mjs';

const usage = 'Usage: node scripts/cnki_verify_journals.mjs --input <cnki.json> [--input <more.json>] --output <journal-evidence.json>';
const args = parseArgs(process.argv.slice(2), new Set(['input']));
requireArgs(args, ['input', 'output'], usage);
const inputPaths = Array.isArray(args.input) ? args.input : [args.input];
const wanted = new Map();

for (const inputPath of inputPaths) {
  const payload = JSON.parse(await fs.readFile(String(inputPath), 'utf8'));
  for (const record of payload.records ?? payload) {
    if (record.database && String(record.database).toUpperCase() !== 'CNKI') continue;
    if (record.documentType !== '期刊' || !record.doi || !record.sourceHref) continue;
    if (!wanted.has(record.sourceTitle)) wanted.set(record.sourceTitle, record.sourceHref);
  }
}

const chromium = await loadChromium();
const browser = await chromium.connectOverCDP(String(args['debugger-url'] ?? 'http://127.0.0.1:9333'));
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error('No Edge context is available. Start edge_session.mjs first.');
  const page = await context.newPage();
  const results = [];
  const badgeTerms = [
    'EI', 'SCI', 'SSCI', 'CSSCI', 'CSCD', '北大核心', '中文核心', '科技核心',
    '中国科学引文数据库', '中国科技核心期刊', 'AMI', 'WJCI', '卓越期刊', '核心期刊',
  ];

  for (const [sourceTitle, sourceHref] of wanted) {
    const item = {
      sourceTitle,
      sourceHref,
      resolvedUrl: '',
      pageTitle: '',
      status: '',
      badges: [],
      metrics: [],
      journalScoreCandidate: null,
      evidenceText: '',
      checkedAt: new Date().toISOString(),
    };
    try {
      const response = await page.goto(sourceHref, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.waitForTimeout(2_500);
      item.resolvedUrl = page.url();
      item.pageTitle = await page.title();
      item.status = String(response?.status() ?? '');
      const bodyText = String(await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
      item.badges = badgeTerms.filter((term) => bodyText.toUpperCase().includes(term.toUpperCase()));
      const metricPattern = /((?:复合|综合)影响因子)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)/g;
      item.metrics = [...bodyText.matchAll(metricPattern)].map((match) => ({
        label: match[1],
        value: Number(match[2]),
      }));
      const comprehensive = item.metrics.filter((metric) => metric.label === '综合影响因子');
      item.journalScoreCandidate = comprehensive.length ? Math.max(...comprehensive.map((metric) => metric.value)) : null;
      const fragments = [];
      for (const term of [...item.badges, '影响因子']) {
        const index = bodyText.toUpperCase().indexOf(term.toUpperCase());
        if (index >= 0) fragments.push(bodyText.slice(Math.max(0, index - 100), Math.min(bodyText.length, index + term.length + 220)));
      }
      item.evidenceText = [...new Set(fragments)].join(' | ').slice(0, 5000);
    } catch (error) {
      item.status = `ERROR: ${error?.message ?? error}`;
    }
    results.push(item);
    console.log(`${sourceTitle}: ${item.badges.join(', ') || 'no badge detected'} (${item.status})`);
  }

  await fs.mkdir(path.dirname(path.resolve(String(args.output))), { recursive: true });
  await fs.writeFile(String(args.output), `${JSON.stringify({ journals: results }, null, 2)}\n`, 'utf8');
  await page.close();
} finally {
  await browser.close();
}

