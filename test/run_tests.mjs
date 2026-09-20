import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyCnkiSnapshot,
  normalizeDatabaseQuery,
  rectIntersectsViewport,
} from '../scripts/lib/retrieval.mjs';
import {
  buildDatabaseTarget,
  defaultDatabases,
  formatDatabaseMenu,
  loadDatabaseCatalog,
  looksLikeBooleanExpression,
  makeSelectionPlan,
  parseDatabaseSelection,
  validateDatabaseCatalog,
} from '../scripts/lib/database-catalog.mjs';
import {
  buildExternalEdgeArgs,
  classifyAccessPage,
  classifyCqvipPage,
  normalizeLoopbackCdpUrl,
} from '../scripts/lib/browser-session.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDir, '..');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-cnki-skill-test-'));
const inputPath = path.join(temporaryRoot, 'candidates.json');
const outputDir = path.join(temporaryRoot, 'output');

function runRaw(script, args) {
  return spawnSync(process.execPath, [path.join(skillRoot, 'scripts', script), ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function run(script, args) {
  const result = runRaw(script, args);
  if (result.status !== 0) {
    throw new Error(`${script} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  const catalog = await loadDatabaseCatalog(path.join(skillRoot, 'config', 'database-catalog.json'));
  assert.equal(catalog.databases.length, 22, 'catalog must contain WOS plus the 21 WHLIB full-text entries');
  assert.equal(catalog.databases.filter((database) => database.whlibListed).length, 21, 'all WHLIB full-text entries must be represented');
  assert.equal(catalog.databases.filter((database) => database.queryCapability === 'boolean').length, 20);
  assert.equal(catalog.databases.filter((database) => database.queryCapability === 'keyword-batches').length, 2);
  const firstKeywordIndex = catalog.databases.findIndex((database) => database.queryCapability === 'keyword-batches');
  assert.ok(firstKeywordIndex > 0);
  assert.ok(
    catalog.databases.slice(0, firstKeywordIndex).every((database) => database.queryCapability === 'boolean'),
    'all Boolean-capable databases must be numbered before keyword-batch databases',
  );
  assert.ok(
    catalog.databases.slice(firstKeywordIndex).every((database) => database.queryCapability === 'keyword-batches'),
    'no Boolean-capable database may appear after the keyword-batch group',
  );
  assert.ok(catalog.databases.every((database) => database.capabilityEvidence), 'every capability classification needs evidence');
  assert.deepEqual(defaultDatabases(catalog).map((database) => database.id), ['wos', 'cnki']);
  assert.deepEqual(
    parseDatabaseSelection('3,5-6,2', catalog).map((database) => database.id),
    ['cnki', 'elsevier', 'wiley', 'science'],
    'numbered selection must deduplicate and follow stable catalog order',
  );
  assert.deepEqual(parseDatabaseSelection('0', catalog).map((database) => database.id), ['wos', 'cnki']);
  assert.throws(() => parseDatabaseSelection('23', catalog), /unknown database selection/i);
  assert.throws(() => parseDatabaseSelection('0,3', catalog), /cannot be combined/i);
  const elsevier = catalog.databases.find((database) => database.id === 'elsevier');
  const target = buildDatabaseTarget(elsevier, '(岩石 OR rock) AND mechanics', { queryType: 'boolean' });
  assert.equal(target.queryApplied, true);
  assert.match(target.url, /\(%E5%B2%A9%E7%9F%B3%20OR%20rock\)%20AND%20mechanics/);
  assert.equal(looksLikeBooleanExpression('(rock OR stone) AND mechanics'), true);
  assert.equal(looksLikeBooleanExpression('rock mechanics'), false);
  assert.throws(
    () => buildDatabaseTarget(elsevier, 'rock mechanics', { queryType: 'boolean' }),
    /explicit site-specific expression/i,
  );
  assert.throws(
    () => buildDatabaseTarget(elsevier, 'rock mechanics', { queryType: 'keyword' }),
    /requires --boolean-query/i,
  );
  const customPlan = makeSelectionPlan(catalog, parseDatabaseSelection('3', catalog), {
    mode: 'custom',
    booleanQuery: '(rock OR stone) AND mechanics',
  });
  assert.equal(customPlan.databases[0].queryApplied, true);
  assert.equal(customPlan.queryType, 'boolean');
  const wiley = catalog.databases.find((database) => database.id === 'wiley');
  const wileyPlan = makeSelectionPlan(catalog, [wiley], {
    mode: 'custom',
    booleanQuery: '(rock OR stone) AND mechanics',
  });
  assert.equal(wileyPlan.databases[0].queryApplied, false, 'advanced-form platforms must not pretend to submit a query');
  assert.equal(wileyPlan.databases[0].queryPending, true);
  assert.equal(wileyPlan.databases[0].queryInputMode, 'advanced-form');
  assert.throws(
    () => makeSelectionPlan(catalog, parseDatabaseSelection('3,4', catalog), {
      mode: 'custom',
      booleanQuery: '(rock OR stone) AND mechanics',
    }),
    /select exactly one database/i,
    'one Boolean expression must never be reused across database dialects',
  );
  const nature = catalog.databases.find((database) => database.id === 'nature-nsj');
  const naturePlan = makeSelectionPlan(catalog, [nature], { mode: 'custom', keywordQuery: 'rock mechanics' });
  assert.equal(naturePlan.databases[0].queryApplied, true);
  assert.equal(naturePlan.queryType, 'keyword');
  assert.throws(
    () => makeSelectionPlan(catalog, [nature], { mode: 'custom', booleanQuery: 'rock AND mechanics' }),
    /requires --keyword-query/i,
  );
  assert.throws(
    () => makeSelectionPlan(catalog, [nature], { mode: 'custom', keywordQuery: 'rock AND mechanics' }),
    /do not paste a boolean expression/i,
  );
  const casDissertations = catalog.databases.find((database) => database.id === 'cas-dissertations');
  assert.equal(casDissertations.number, 22);
  assert.equal(casDissertations.launchUrl, 'http://dpaper.las.ac.cn/Dpaper/search/searchNew');
  assert.equal(casDissertations.allowInsecureHttp, true, 'the verified HTTP-only CAS endpoint must be explicitly allowlisted');
  const casPlan = makeSelectionPlan(catalog, [casDissertations], { mode: 'custom' });
  assert.equal(casPlan.databases[0].allowInsecureHttp, true, 'the HTTP exception must survive plan generation');
  const rejectedHttpCatalog = structuredClone(catalog);
  rejectedHttpCatalog.databases.find((database) => database.id === 'elsevier').launchUrl = 'http://www.sciencedirect.com/';
  assert.throws(
    () => validateDatabaseCatalog(rejectedHttpCatalog),
    /must use HTTPS/i,
    'HTTP must remain rejected unless the catalog explicitly allowlists that database',
  );
  const cqvip = catalog.databases.find((database) => database.id === 'cqvip');
  assert.equal(cqvip.number, 17);
  assert.equal(cqvip.queryCapability, 'boolean');
  assert.equal(cqvip.booleanSubmission, 'visible-search-box');
  assert.equal(cqvip.requiresPersistentProfile, true);
  assert.equal(cqvip.automationScript, 'scripts/cqvip_search.mjs');
  const databaseMenu = formatDatabaseMenu(catalog);
  assert.match(databaseMenu, /^0\. 默认：1 Web of Science \+ 2 CNKI 中国学术期刊/m);
  assert.match(databaseMenu, /【可构建布尔高级检索式：必须使用各库专用布尔逻辑】/);
  assert.match(databaseMenu, /【不构建布尔表达式：关键词\/字段分批检索后合并去重】/);
  assert.ok(databaseMenu.indexOf('20. 尚唯科技报告') < databaseMenu.indexOf('21. Nature + NSJ'));

  assert.equal(
    classifyAccessPage({ status: 412, finalUrl: 'https://qikan.cqvip.com/', title: '', bodyText: '' }),
    'automation-restricted',
    'CQVIP 412 must be reported as an automation restriction rather than site unavailability',
  );
  assert.equal(
    classifyAccessPage({ status: 412, finalUrl: 'https://example.org/', title: '', bodyText: '' }),
    'http-412',
    'the CQVIP exception must not hide unrelated HTTP failures',
  );
  assert.equal(
    classifyCqvipPage({
      finalUrl: 'https://qikan.cqvip.com/',
      title: '中文期刊服务平台',
      bodyText: '中文期刊服务平台',
      searchInputVisible: true,
    }),
    'ready',
  );
  assert.equal(
    classifyCqvipPage({
      finalUrl: 'https://qikan.cqvip.com/',
      title: '412 Precondition Failed',
      bodyText: '',
      searchInputVisible: false,
    }),
    'automation-restricted',
  );
  assert.equal(normalizeLoopbackCdpUrl('http://localhost:9333/'), 'http://localhost:9333');
  assert.throws(() => normalizeLoopbackCdpUrl('http://192.0.2.1:9333'), /loopback/i);
  const externalEdgeArgs = buildExternalEdgeArgs({
    profileDir: path.join(temporaryRoot, 'edge-profile'),
    port: 9333,
    startUrls: ['https://qikan.cqvip.com/'],
  });
  assert.ok(externalEdgeArgs.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(externalEdgeArgs.includes('--remote-debugging-port=9333'));
  assert.ok(!externalEdgeArgs.some((value) => /enable-automation|disable-blink-features/i.test(value)), 'do not add stealth or fingerprint-evasion flags');
  const edgeDryRun = runRaw('start_edge_cdp.mjs', [
    '--profile-dir', path.join(temporaryRoot, 'edge-profile'),
    '--port', '9333',
    '--start-url', 'https://qikan.cqvip.com/',
    '--dry-run', 'true',
  ]);
  assert.equal(edgeDryRun.status, 0, `start_edge_cdp dry run failed: ${edgeDryRun.stderr}`);
  const edgeDryRunPayload = JSON.parse(edgeDryRun.stdout);
  assert.equal(edgeDryRunPayload.status, 'dry-run');
  assert.equal(edgeDryRunPayload.debuggerUrl, 'http://127.0.0.1:9333');

  const listResult = runRaw('select_databases.mjs', ['--list']);
  assert.equal(listResult.status, 0, 'database menu must render without side effects');
  assert.match(listResult.stdout, /是否使用默认的 WOS \+ 知网完整采集？/);
  assert.match(listResult.stdout, /布尔组必须使用各库专用布尔表达式/);
  assert.match(listResult.stdout, /17\. 维普中文期刊服务平台/);
  assert.match(listResult.stdout, /22\. 中国科学院学位论文/);
  const genericQueryPlan = runRaw('select_databases.mjs', ['--selection', '3', '--query', 'rock mechanics']);
  assert.notEqual(genericQueryPlan.status, 0);
  assert.match(genericQueryPlan.stderr, /generic --query is disabled/i);
  const wrongBooleanPlan = runRaw('select_databases.mjs', ['--selection', '3', '--keyword-query', 'rock mechanics']);
  assert.notEqual(wrongBooleanPlan.status, 0);
  assert.match(wrongBooleanPlan.stderr, /requires --boolean-query/i);
  const validBooleanPlan = runRaw('select_databases.mjs', [
    '--selection', '3',
    '--boolean-query', '(rock OR stone) AND mechanics',
  ]);
  assert.equal(validBooleanPlan.status, 0, validBooleanPlan.stderr);
  assert.equal(JSON.parse(validBooleanPlan.stdout).queryType, 'boolean');
  const validKeywordPlan = runRaw('select_databases.mjs', [
    '--selection', '21',
    '--keyword-query', 'rock mechanics',
  ]);
  assert.equal(validKeywordPlan.status, 0, validKeywordPlan.stderr);
  assert.equal(JSON.parse(validKeywordPlan.stdout).queryType, 'keyword');
  const wrongKeywordPlan = runRaw('select_databases.mjs', [
    '--selection', '21',
    '--boolean-query', 'rock AND mechanics',
  ]);
  assert.notEqual(wrongKeywordPlan.status, 0);
  assert.match(wrongKeywordPlan.stderr, /requires --keyword-query/i);
  const cqvipGenericQuery = runRaw('cqvip_search.mjs', ['--query', 'rock mechanics']);
  assert.notEqual(cqvipGenericQuery.status, 0);
  assert.match(cqvipGenericQuery.stderr, /generic --query is disabled/i);
  const cqvipNonBooleanQuery = runRaw('cqvip_search.mjs', ['--boolean-query', 'rock mechanics']);
  assert.notEqual(cqvipNonBooleanQuery.status, 0);
  assert.match(cqvipNonBooleanQuery.stderr, /requires an explicit/i);
  const planPath = path.join(temporaryRoot, 'database-selection.json');
  run('select_databases.mjs', ['--default', '--output', planPath]);
  const savedPlan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  assert.deepEqual(savedPlan.databases.map((database) => database.id), ['wos', 'cnki']);

  const normalizedQuery = normalizeDatabaseQuery("TKA%=(\n  'multi word concept'\n  + 'synonym'\n)\nAND TI%=('method')", 'CNKI');
  assert.ok(!/[\r\n]/.test(normalizedQuery), 'professional queries must be normalized to one line');
  assert.ok(normalizedQuery.includes("'multi word concept'"), 'whitespace inside quoted phrases must be preserved');
  assert.equal(
    classifyCnkiSnapshot({ bodyText: '抱歉，暂无数据，请稍后重试。', rowCount: 0, captchaVisible: false }).kind,
    'transient-error',
    'CNKI retry pages must not be classified as zero results',
  );
  assert.equal(
    classifyCnkiSnapshot({ bodyText: '拖动下方拼图完成验证', rowCount: 0, captchaVisible: true }).kind,
    'manual-verification',
    'a viewport-visible CAPTCHA must pause for the user',
  );
  assert.equal(
    classifyCnkiSnapshot({ bodyText: '拖动下方拼图完成验证', rowCount: 0, captchaVisible: false }).kind,
    'indeterminate',
    'stale CAPTCHA text without a visible control must not pause the run',
  );
  assert.equal(
    classifyCnkiSnapshot({ bodyText: '共找到 0 条结果', resultCount: 0, rowCount: 0, captchaVisible: false }).kind,
    'confirmed-empty-candidate',
    'only an explicit zero count may enter the stable-empty timer',
  );
  assert.equal(
    classifyCnkiSnapshot({ bodyText: '共找到 70 条结果', resultCount: 70, rowCount: 20, captchaVisible: false }).kind,
    'results',
    'visible result rows must win over stale page text',
  );
  assert.ok(
    !rectIntersectsViewport(
      { left: 0, top: -1_000_167, right: 400, bottom: -999_867, width: 400, height: 300 },
      { width: 1280, height: 720 },
    ),
    'offscreen stale CAPTCHA geometry must not count as visible',
  );
  assert.ok(
    rectIntersectsViewport(
      { left: 300, top: 150, right: 700, bottom: 450, width: 400, height: 300 },
      { width: 1280, height: 720 },
    ),
    'viewport-intersecting CAPTCHA geometry must count as visible',
  );

  const extractedDir = path.join(temporaryRoot, 'extracted');
  run('extract_strategy.mjs', [
    '--strategy', path.join(testDir, 'fixtures', 'strategy.md'),
    '--output', extractedDir,
    '--config-template', path.join(testDir, 'config.json'),
  ]);
  const extractedMap = JSON.parse(await fs.readFile(path.join(extractedDir, 'queries.json'), 'utf8'));
  assert.deepEqual(Object.keys(extractedMap.groups).sort(), ['GROUP_ALPHA', '主题B'].sort(), 'strategy groups must be topic-agnostic');
  assert.equal(extractedMap.groups.GROUP_ALPHA.WOS.length, 1, 'WOS query block must be extracted');
  assert.equal(extractedMap.groups.GROUP_ALPHA.CNKI.length, 1, 'CNKI query block must be extracted');

  const mismatchedWithoutMap = runRaw('extract_strategy.mjs', [
    '--strategy', path.join(testDir, 'fixtures', 'strategy-mismatched.md'),
    '--output', path.join(temporaryRoot, 'unmapped'),
  ]);
  assert.notEqual(mismatchedWithoutMap.status, 0, 'unpaired cross-database labels must require an explicit semantic map');
  assert.match(mismatchedWithoutMap.stderr, /group labels are not paired/i);

  const mappedDir = path.join(temporaryRoot, 'mapped');
  run('extract_strategy.mjs', [
    '--strategy', path.join(testDir, 'fixtures', 'strategy-mismatched.md'),
    '--group-map', path.join(testDir, 'fixtures', 'group-map.json'),
    '--output', mappedDir,
    '--config-template', path.join(testDir, 'config.json'),
  ]);
  const mapped = JSON.parse(await fs.readFile(path.join(mappedDir, 'queries.json'), 'utf8'));
  assert.deepEqual(Object.keys(mapped.groups).sort(), ['METHOD_A', 'METHOD_B']);
  assert.deepEqual(mapped.groups.METHOD_A.sourceGroups, { WOS: ['A'], CNKI: ['Q1'] });
  const normalizedCnkiFile = await fs.readFile(path.join(mappedDir, 'queries', 'METHOD_A_CNKI_1.txt'), 'utf8');
  assert.equal(normalizedCnkiFile.trim().split(/\r?\n/).length, 1, 'extracted CNKI professional query must be one line');

  const autoOutputDir = path.join(temporaryRoot, 'auto-output');
  run('select_and_export.mjs', [
    '--config', path.join(skillRoot, 'config', 'default.json'),
    '--output', autoOutputDir,
    '--input', path.join(skillRoot, 'examples', 'candidates.sample.json'),
  ]);
  run('validate_outputs.mjs', [
    '--config', path.join(skillRoot, 'config', 'default.json'),
    '--input', autoOutputDir,
  ]);
  await fs.access(path.join(autoOutputDir, 'GROUP_A_WOS.txt'));
  await fs.access(path.join(autoOutputDir, 'GROUP_A_CNKI.txt'));

  const fixture = JSON.parse(await fs.readFile(path.join(testDir, 'fixtures', 'candidates.json'), 'utf8'));
  const generatedRecentWos = Array.from({ length: 11 }, (_, index) => ({
    group: 'TOPIC_A',
    database: 'WOS',
    title: `Recent cross-domain method article ${index + 1}`,
    year: 2024 + (index % 3),
    authors: [`Author ${index + 1}`],
    doi: `10.5555/wos.recent.${index + 1}`,
    sourceTitle: `Test Journal ${1 + (index % 4)}`,
    documentType: 'Article',
    webOfScienceIndex: 'Science Citation Index Expanded (SCI-EXPANDED)',
    citedCount: 100 - index,
    relevanceScore: 0.9 + ((10 - index) / 1000),
    relevanceEvidence: 'A and B are central.',
    journalTier: 2 + (index % 4),
    journalScore: 6 - (index % 4),
    journalEvidence: 'Verified test journal tier.',
  }));
  const payload = { records: [...fixture.records, ...generatedRecentWos] };
  await fs.writeFile(inputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  run('select_and_export.mjs', [
    '--config', path.join(testDir, 'config.json'),
    '--output', outputDir,
    '--input', inputPath,
  ]);
  run('validate_outputs.mjs', [
    '--config', path.join(testDir, 'config.json'),
    '--input', outputDir,
  ]);

  const report = JSON.parse(await fs.readFile(path.join(outputDir, 'selection-report.json'), 'utf8'));
  const wos = report.pools.find((pool) => pool.group === 'TOPIC_A' && pool.database === 'WOS');
  const cnki = report.pools.find((pool) => pool.group === 'TOPIC_A' && pool.database === 'CNKI');
  assert.equal(wos.selectedCount, 10, 'WOS must be capped independently at 10');
  assert.equal(cnki.selectedCount, 3, 'CNKI must keep its own qualifying count, not fill a shared quota');
  assert.ok(wos.selected.some((record) => record.doi === '10.5555/wos.old.high'), 'old top-impact WOS record must pass');
  assert.ok(!wos.selected.some((record) => record.doi === '10.5555/wos.old.low'), 'old low-impact WOS record must fail');
  assert.ok(cnki.selected.some((record) => record.doi === '10.5555/cnki.old.high'), 'old top-impact CNKI record must pass');
  assert.ok(!cnki.selected.some((record) => record.doi === '10.5555/cnki.old.low'), 'old low-impact CNKI record must fail');
  assert.ok(wos.exclusions.some((record) => record.reason === 'wos-not-article'), 'WOS review gate must be exercised');
  assert.ok(cnki.exclusions.some((record) => record.reason === 'cnki-not-journal'), 'CNKI journal gate must be exercised');

  const cnkiRecentTwo = cnki.selected.find((record) => record.doi === '10.5555/cnki.recent.2');
  assert.equal(cnkiRecentTwo.formalYear, 2024, 'GB/T formal year must override the result-list year');
  const wosBuffer = await fs.readFile(path.join(outputDir, 'TOPIC_A_WOS.txt'));
  assert.deepEqual([...wosBuffer.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'TXT must include UTF-8 BOM');

  console.log('PASS: confirmation menu, Boolean-first numbering, mandatory database-specific Boolean queries, keyword-batch isolation, 22-source catalog, HTTP allowlist, external Edge/CDP routing, CQVIP restriction diagnosis, query targets, viewport CAPTCHA detection, semantic group mapping, generic extraction, selection, year exception, publication gates, independent quotas, GB/T year, and BOM');
} finally {
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  if (!resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir()))) {
    throw new Error(`Refusing to clean unexpected test path: ${resolvedTemporaryRoot}`);
  }
  await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
}
