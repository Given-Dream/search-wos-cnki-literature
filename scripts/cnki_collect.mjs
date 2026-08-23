import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';
import { loadChromium } from './lib/playwright.mjs';

async function collectVisiblePage(page, rankOffset, maximum, group) {
  return page.evaluate(async ({ rankOffset: offset, maximum: limit, group: queryGroup }) => {
    const normalize = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
    const extractFormalYear = (citation) => {
      const journalYear = citation.match(/\[J\][\s\S]*?[,，]\s*((?:19|20)\d{2})\s*[,，]/i);
      return Number(journalYear?.[1] ?? 0) || '';
    };
    const rows = Array.from(document.querySelectorAll('table.result-table-list tbody tr')).slice(0, limit);
    const quoteUrl = document.querySelector('#hidQuoteUrl')?.value || '';
    const uniplatform = window.jQuery?.getUniplatform?.() || '';
    const language = window.jQuery?.getLanguage?.() || '';
    const records = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const cells = Array.from(row.querySelectorAll('td'));
      const cellText = cells.map((cell) => normalize(cell.innerText));
      const titleLink = row.querySelector('td.name a, a.fz14, a.title');
      const sourceLink = cells[3]?.querySelector('a[href*="navi.cnki.net"]');
      const fileInput = row.querySelector('td.seq input, td.seq a.cbItem');
      const filename = fileInput?.value || fileInput?.getAttribute('value') || '';
      const listYear = Number((cellText[4]?.match(/(?:19|20)\d{2}/) ?? ['0'])[0]) || '';
      const record = {
        group: queryGroup,
        database: 'CNKI',
        rank: offset + index + 1,
        title: normalize(titleLink?.textContent),
        authors: cellText[2] || '',
        sourceTitle: cellText[3] || '',
        sourceHref: sourceLink?.href || '',
        detailHref: titleLink?.href || '',
        year: listYear,
        formalYear: '',
        documentType: cellText[5] || '',
        citedCount: Number((cellText[6]?.match(/\d+/) ?? ['0'])[0]),
        downloadCount: Number((cellText[7]?.match(/\d+/) ?? ['0'])[0]),
        doi: '',
        citation: '',
        quoteStatus: '',
      };

      if (filename && quoteUrl) {
        try {
          const body = new URLSearchParams({
            filename,
            displaymode: 'GBTREFER',
            uniplatform,
            subject: '',
            language,
          });
          const response = await fetch(quoteUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: body.toString(),
          });
          const payload = await response.json();
          const citation = normalize(payload?.data?.[0]?.value?.[0] ?? '').replace(/<br\s*\/?\s*>/gi, '');
          const doiMatch = citation.match(/DOI:\s*(10\.\d{4,9}\/[^\s<]+)/i);
          record.citation = citation;
          record.doi = (doiMatch?.[1] ?? '').replace(/[.。；;，,]+$/, '');
          record.formalYear = extractFormalYear(citation) || listYear;
          record.quoteStatus = `${response.status}:${payload?.code ?? ''}`;
        } catch (error) {
          record.quoteStatus = String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
      records.push(record);
    }
    return records;
  }, { rankOffset, maximum, group });
}

const usage = 'Usage: node scripts/cnki_collect.mjs --query-file <path> --output <json> [--limit 300] --label <GROUP_ID>';
const args = parseArgs(process.argv.slice(2));
requireArgs(args, ['query-file', 'output'], usage);
const query = (await fs.readFile(String(args['query-file']), 'utf8')).trim();
if (!query) throw new Error('The CNKI query file is empty.');
const group = String(args.label ?? '').toUpperCase();
if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u.test(group)) throw new Error('Pass a filesystem-safe --label group ID without spaces.');
const requestedLimit = Math.max(1, Math.min(500, Number(args.limit ?? 300)));
const debuggerUrl = String(args['debugger-url'] ?? 'http://127.0.0.1:9333');

const chromium = await loadChromium();
const browser = await chromium.connectOverCDP(debuggerUrl);
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error('No Edge context is available. Start edge_session.mjs first.');
  let page = context.pages().filter((candidate) => candidate.url().includes('kns.cnki.net')).at(-1);
  if (!page) page = await context.newPage();
  await page.goto('https://kns.cnki.net/kns8s/AdvSearch', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(2_000);

  await page.locator('li[name="majorSearch"]').click({ timeout: 30_000 });
  const queryBox = page.locator('textarea.textarea-major');
  await queryBox.waitFor({ state: 'visible', timeout: 30_000 });
  await queryBox.fill(query);
  await page.locator('input.btn-search').click({ timeout: 30_000 });
  await page.waitForTimeout(5_000);

  const bodyText = await page.locator('body').innerText();
  if (/拖动下方拼图完成验证/.test(bodyText) && !/共找到\s*[\d,]+\s*条结果/.test(bodyText)) {
    throw new Error('CNKI requires manual slider verification. Complete it in the visible Edge window and rerun.');
  }
  const countMatch = bodyText.match(/共找到\s*([\d,]+)\s*条结果/);
  const resultCount = countMatch ? Number(countMatch[1].replaceAll(',', '')) : 0;
  if (/暂无数据/.test(bodyText) || resultCount === 0) {
    const empty = { label: group, database: 'CNKI', query, resultCount: 0, collected: 0, records: [] };
    await fs.mkdir(path.dirname(path.resolve(String(args.output))), { recursive: true });
    await fs.writeFile(String(args.output), `${JSON.stringify(empty, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(empty, null, 2));
    process.exitCode = 2;
  } else {
    await page.locator('table.result-table-list tbody tr').first().waitFor({ state: 'visible', timeout: 60_000 });
    const targetCount = Math.min(resultCount, requestedLimit);
    if (targetCount > 20 && await page.locator('#perPageDiv li[data-val="50"]').count()) {
      await page.locator('#perPageDiv .sort-default').click({ timeout: 30_000 });
      await page.locator('#perPageDiv li[data-val="50"]').click({ timeout: 30_000 });
      await page.waitForFunction(
        (expected) => document.querySelectorAll('table.result-table-list tbody tr').length >= expected,
        Math.min(50, resultCount),
        { timeout: 60_000 },
      );
    }

    const records = [];
    while (records.length < targetCount) {
      const pageRecords = await collectVisiblePage(page, records.length, targetCount - records.length, group);
      if (!pageRecords.length) break;
      const known = new Set(records.map((record) => `${record.title}\u0000${record.authors}`));
      for (const record of pageRecords) {
        const key = `${record.title}\u0000${record.authors}`;
        if (!known.has(key)) {
          records.push(record);
          known.add(key);
        }
      }
      if (records.length >= targetCount) break;
      const next = page.locator('#PageNext');
      if (!await next.count() || !await next.isVisible()) break;
      const before = await page.locator('table.result-table-list tbody tr').first().innerText();
      await next.click({ timeout: 30_000 });
      await page.waitForFunction(
        (previous) => document.querySelector('table.result-table-list tbody tr')?.innerText !== previous,
        before,
        { timeout: 60_000 },
      );
      await page.waitForTimeout(1_500);
    }

    const result = {
      label: group,
      database: 'CNKI',
      query,
      resultCount,
      collected: records.length,
      collectedAt: new Date().toISOString(),
      records: records.slice(0, targetCount),
    };
    await fs.mkdir(path.dirname(path.resolve(String(args.output))), { recursive: true });
    await fs.writeFile(String(args.output), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      label: group,
      resultCount,
      collected: result.records.length,
      withDoi: result.records.filter((record) => record.doi).length,
      withFormalYear: result.records.filter((record) => record.formalYear).length,
      output: path.resolve(String(args.output)),
    }, null, 2));
  }
} finally {
  await browser.close();
}
