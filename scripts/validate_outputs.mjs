import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';
import { isPlausibleDoi, resolveCurrentYear, safeFileComponent } from './lib/screening.mjs';

function parseBlocks(text) {
  return text
    .replace(/^\uFEFF/, '')
    .split(/^---\s*$/m)
    .map((block) => block.trim())
    .filter((block) => /^\[\d+\]/.test(block))
    .map((block) => {
      const fields = {};
      for (const row of block.split(/\r?\n/).slice(1)) {
        const match = row.match(/^([^:]+):\s*(.*)$/);
        if (match) fields[match[1]] = match[2].trim();
      }
      return fields;
    });
}

const usage = 'Usage: node scripts/validate_outputs.mjs --config <json> --input <output-dir> [--report <json>]';
const args = parseArgs(process.argv.slice(2));
requireArgs(args, ['config', 'input'], usage);
const config = JSON.parse(await fs.readFile(String(args.config), 'utf8'));
const selection = config.selection ?? config;
const currentYear = resolveCurrentYear(selection);
const recentStart = currentYear - Number(selection.recentYearSpan ?? 3) + 1;
const maxCount = Number(selection.maxPerDatabaseGroup ?? 10);
const inputDir = path.resolve(String(args.input));
const results = [];
const errors = [];
let selectionReport = null;
try {
  selectionReport = JSON.parse(await fs.readFile(path.join(inputDir, 'selection-report.json'), 'utf8'));
} catch (error) {
  errors.push(`selection-report.json: missing or invalid (${error.code ?? error.message})`);
}
const configuredGroups = selection.groups;
const groups = Array.isArray(configuredGroups) && configuredGroups.length
  ? configuredGroups.map((group) => String(group).trim().toUpperCase())
  : (selectionReport?.policy?.groups ?? []);
const databases = (selection.databases ?? ['WOS', 'CNKI']).map((database) => String(database).toUpperCase());
if (!groups.length) errors.push('No strategy groups are available for validation.');

for (const group of groups) {
  for (const database of databases) {
    let filename;
    try {
      filename = `${safeFileComponent(group)}_${database}.txt`;
    } catch (error) {
      errors.push(String(error.message ?? error));
      continue;
    }
    const filePath = path.join(inputDir, filename);
    let buffer;
    try {
      buffer = await fs.readFile(filePath);
    } catch (error) {
      errors.push(`${filename}: missing (${error.code ?? error.message})`);
      continue;
    }
    const hasBom = buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
    if (!hasBom) errors.push(`${filename}: missing UTF-8 BOM`);
    const blocks = parseBlocks(buffer.toString('utf8'));
    if (blocks.length > maxCount) errors.push(`${filename}: ${blocks.length} records exceeds ${maxCount}`);
    const seen = new Set();
    for (let index = 0; index < blocks.length; index += 1) {
      const fields = blocks[index];
      for (const required of ['Title', 'Year', 'Authors', 'DOI']) {
        if (!fields[required]) errors.push(`${filename} record ${index + 1}: missing ${required}`);
      }
      if (fields.DOI && !isPlausibleDoi(fields.DOI)) errors.push(`${filename} record ${index + 1}: invalid DOI ${fields.DOI}`);
      const doiKey = String(fields.DOI ?? '').toLowerCase();
      if (doiKey && seen.has(doiKey)) errors.push(`${filename} record ${index + 1}: duplicate DOI ${fields.DOI}`);
      seen.add(doiKey);
      const year = Number(fields.Year);
      if (!Number.isInteger(year) || year < 1900 || year > currentYear) errors.push(`${filename} record ${index + 1}: invalid/future year ${fields.Year}`);
      if (year < recentStart && fields['Time Rule'] !== 'older-high-impact-exception') {
        errors.push(`${filename} record ${index + 1}: older year without high-impact exception`);
      }
      if (fields.Database && fields.Database !== database) errors.push(`${filename} record ${index + 1}: database label mismatch`);
    }
    results.push({ filename, records: blocks.length, hasBom });
  }
}

for (const required of ['筛选说明与数量核验.txt']) {
  try {
    await fs.access(path.join(inputDir, required));
  } catch {
    errors.push(`${required}: missing`);
  }
}

const report = {
  status: errors.length ? 'FAIL' : 'PASS',
  inputDir,
  currentYear,
  recentWindow: [recentStart, currentYear],
  files: results,
  errors,
};
if (args.report) {
  await fs.mkdir(path.dirname(path.resolve(String(args.report))), { recursive: true });
  await fs.writeFile(String(args.report), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
