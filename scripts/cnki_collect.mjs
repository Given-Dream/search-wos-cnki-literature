import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';
import { loadChromium } from './lib/playwright.mjs';
import { classifyCnkiSnapshot, normalizeDatabaseQuery } from './lib/retrieval.mjs';

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function auditSnapshot(snapshot) {
  return {
    url: snapshot?.url ?? '',
    title: snapshot?.title ?? '',
    resultCount: snapshot?.resultCount ?? null,
    rowCount: snapshot?.rowCount ?? 0,
    captchaVisible: Boolean(snapshot?.captchaVisible),
    bodyExcerpt: String(snapshot?.bodyText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000),
  };
}

async function readCnkiSnapshot(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText ?? '';
    const countMatch = bodyText.match(/共找到\s*([\d,]+)\s*条结果/i);
    const captcha = document.querySelector('#tCaptchaDyMainWrap');
    let captchaVisible = false;
    if (captcha?.isConnected && !captcha.hidden && captcha.getAttribute('aria-hidden') !== 'true') {
      let current = captcha;
      let hiddenByAncestor = false;
      while (current) {
        const style = getComputedStyle(current);
        if (current.hidden
          || current.getAttribute('aria-hidden') === 'true'
          || style.display === 'none'
          || style.visibility === 'hidden'
          || Number(style.opacity) === 0) {
          hiddenByAncestor = true;
          break;
        }
        current = current.parentElement;
      }
      const rect = captcha.getBoundingClientRect();
      captchaVisible = !hiddenByAncestor
        && rect.width > 0
        && rect.height > 0
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight;
    }
    return {
      url: location.href,
      title: document.title,
      bodyText,
      resultCount: countMatch ? Number(countMatch[1].replaceAll(',', '')) : null,
      rowCount: document.querySelectorAll('table.result-table-list tbody tr').length,
      captchaVisible,
    };
  });
}

async function waitForCnkiOutcome(page, { timeoutMs, minimumSettleMs, emptyStabilityMs, pollMs }) {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let emptySince = 0;
  let lastSnapshot = null;
  let lastClassification = { kind: 'indeterminate', resultCount: null, rowCount: 0 };
  while (Date.now() < deadline) {
    lastSnapshot = await readCnkiSnapshot(page);
    lastClassification = classifyCnkiSnapshot(lastSnapshot);
    if (lastClassification.kind === 'results' || lastClassification.kind === 'manual-verification') {
      return { ...lastClassification, snapshot: lastSnapshot };
    }
    if (lastClassification.kind === 'confirmed-empty-candidate') {
      if (!emptySince) emptySince = Date.now();
      if (Date.now() - startedAt >= minimumSettleMs && Date.now() - emptySince >= emptyStabilityMs) {
        return { kind: 'confirmed-empty', resultCount: 0, rowCount: 0, snapshot: lastSnapshot };
      }
    } else {
      emptySince = 0;
    }
    await page.waitForTimeout(pollMs);
  }
  const kind = lastClassification.kind === 'transient-error' ? 'transient-error' : 'indeterminate-timeout';
  return { ...lastClassification, kind, snapshot: lastSnapshot };
}

async function collectVisiblePage(page, rankOffset, maximum, group, citationDelayMs) {
  return page.evaluate(async ({ rankOffset: offset, maximum: limit, group: queryGroup, citationDelayMs: delayMs }) => {
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
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      records.push(record);
    }
    return records;
  }, { rankOffset, maximum, group, citationDelayMs });
}

const usage = 'Usage: node scripts/cnki_collect.mjs --query-file <path> --output <json> [--state-output <json>] [--limit 300] --label <GROUP_ID>';
const args = parseArgs(process.argv.slice(2));
requireArgs(args, ['query-file', 'output'], usage);
const originalQuery = (await fs.readFile(String(args['query-file']), 'utf8')).trim();
const query = normalizeDatabaseQuery(originalQuery, 'CNKI');
const group = String(args.label ?? '').toUpperCase();
if (!/^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u.test(group)) throw new Error('Pass a filesystem-safe --label group ID without spaces.');
const requestedLimit = boundedInteger(args.limit, 300, 1, 500);
const debuggerUrl = String(args['debugger-url'] ?? 'http://127.0.0.1:9333');
const resultTimeoutMs = boundedInteger(args['result-timeout-ms'], 45_000, 5_000, 120_000);
const minimumSettleMs = boundedInteger(args['minimum-settle-ms'], 15_000, 5_000, 60_000);
const emptyStabilityMs = boundedInteger(args['empty-stability-ms'], 8_000, 2_000, 30_000);
const pollMs = boundedInteger(args['poll-ms'], 1_000, 250, 5_000);
const citationDelayMs = boundedInteger(args['citation-delay-ms'], 300, 100, 5_000);
const outputPath = path.resolve(String(args.output));
const stateOutputPath = path.resolve(String(args['state-output'] ?? `${outputPath}.state.json`));

const chromium = await loadChromium();
const browser = await chromium.connectOverCDP(debuggerUrl);
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error('No Edge context is available. Start edge_session.mjs first.');
  let page = context.pages().filter((candidate) => candidate.url().includes('kns.cnki.net')).at(-1);
  if (!page) page = await context.newPage();
  await page.goto('https://kns.cnki.net/kns8s/AdvSearch', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(2_000);

  const professionalSearch = page.locator('li[name="majorSearch"]');
  if (await professionalSearch.count()) await professionalSearch.click({ timeout: 30_000 });
  const queryBox = page.locator('textarea.textarea-major');
  await queryBox.waitFor({ state: 'visible', timeout: 30_000 });
  await queryBox.fill(query);
  await page.locator('input.btn-search').click({ timeout: 30_000 });

  const outcome = await waitForCnkiOutcome(page, {
    timeoutMs: resultTimeoutMs,
    minimumSettleMs,
    emptyStabilityMs,
    pollMs,
  });
  const state = {
    label: group,
    database: 'CNKI',
    status: outcome.kind,
    query,
    queryWasNormalized: query !== originalQuery,
    observedAt: new Date().toISOString(),
    resultTimeoutMs,
    minimumSettleMs,
    emptyStabilityMs,
    snapshot: auditSnapshot(outcome.snapshot),
  };
  await writeJson(stateOutputPath, state);

  if (outcome.kind === 'manual-verification') {
    throw new Error('CNKI requires manual slider verification in the visible viewport. Complete it in Edge and rerun; the script will not bypass it.');
  }
  if (outcome.kind === 'transient-error' || outcome.kind === 'indeterminate-timeout') {
    throw new Error(
      `CNKI did not reach a stable result state (${outcome.kind}). `
      + 'A “暂无数据，请稍后重试” page is a transient collection failure, not a zero-result query. '
      + `No empty candidate file was written. State: ${stateOutputPath}`,
    );
  }
  if (outcome.kind === 'confirmed-empty') {
    const empty = {
      label: group,
      database: 'CNKI',
      status: 'confirmed-empty',
      query,
      resultCount: 0,
      collected: 0,
      records: [],
    };
    await writeJson(outputPath, empty);
    console.log(JSON.stringify({ ...empty, output: outputPath, stateOutput: stateOutputPath }, null, 2));
    process.exitCode = 2;
  } else {
    const resultCount = Math.max(Number(outcome.resultCount ?? 0), Number(outcome.rowCount ?? 0));
    await page.locator('table.result-table-list tbody tr').first().waitFor({ state: 'visible', timeout: 60_000 });
    const targetCount = Math.min(resultCount, requestedLimit);
    const warnings = [];
    if (targetCount > 20 && await page.locator('#perPageDiv li[data-val="50"]').count()) {
      try {
        await page.locator('#perPageDiv .sort-default').click({ timeout: 30_000 });
        await page.locator('#perPageDiv li[data-val="50"]').click({ timeout: 30_000 });
        await page.waitForFunction(
          (expected) => document.querySelectorAll('table.result-table-list tbody tr').length >= expected,
          Math.min(50, resultCount),
          { timeout: 60_000 },
        );
      } catch (error) {
        warnings.push(`50-row mode unavailable; continued with pagination: ${error?.message ?? error}`);
      }
    }

    const records = [];
    while (records.length < targetCount) {
      const pageRecords = await collectVisiblePage(page, records.length, targetCount - records.length, group, citationDelayMs);
      if (!pageRecords.length) {
        warnings.push('Visible result rows produced no records.');
        break;
      }
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
      if (!await next.count() || !await next.isVisible()) {
        warnings.push('No visible next-page control before the target count was reached.');
        break;
      }
      const before = await page.locator('table.result-table-list tbody tr').first().innerText();
      await next.click({ timeout: 30_000 });
      try {
        await page.waitForFunction(
          (previous) => document.querySelector('table.result-table-list tbody tr')?.innerText !== previous,
          before,
          { timeout: 60_000 },
        );
      } catch (error) {
        warnings.push(`Next page did not load: ${error?.message ?? error}`);
        break;
      }
      await page.waitForTimeout(1_500);
    }

    const complete = records.length >= targetCount;
    const result = {
      label: group,
      database: 'CNKI',
      status: complete ? 'complete' : 'partial',
      query,
      queryWasNormalized: query !== originalQuery,
      resultCount,
      requested: targetCount,
      collected: records.length,
      collectedAt: new Date().toISOString(),
      warnings,
      records: records.slice(0, targetCount),
    };
    await writeJson(outputPath, result);
    await writeJson(stateOutputPath, { ...state, status: result.status, collected: result.collected, warnings });
    console.log(JSON.stringify({
      label: group,
      status: result.status,
      resultCount,
      collected: result.records.length,
      withDoi: result.records.filter((record) => record.doi).length,
      withFormalYear: result.records.filter((record) => record.formalYear).length,
      warnings,
      output: outputPath,
      stateOutput: stateOutputPath,
    }, null, 2));
    if (!complete) process.exitCode = 3;
  }
} finally {
  await browser.close();
}
