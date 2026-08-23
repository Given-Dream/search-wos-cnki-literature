import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDir, '..');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-cnki-skill-test-'));
const inputPath = path.join(temporaryRoot, 'candidates.json');
const outputDir = path.join(temporaryRoot, 'output');

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', script), ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
  return result.stdout;
}

try {
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
    title: `Recent DIC rock fracture article ${index + 1}`,
    year: 2024 + (index % 3),
    authors: [`Author ${index + 1}`],
    doi: `10.5555/wos.recent.${index + 1}`,
    sourceTitle: `Rock Journal ${1 + (index % 4)}`,
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

  console.log('PASS: generic strategy extraction, auto groups, selection, year exception, publication gates, independent quotas, GB/T year, and BOM');
} finally {
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  if (!resolvedTemporaryRoot.startsWith(path.resolve(os.tmpdir()))) {
    throw new Error(`Refusing to clean unexpected test path: ${resolvedTemporaryRoot}`);
  }
  await fs.rm(resolvedTemporaryRoot, { recursive: true, force: true });
}
