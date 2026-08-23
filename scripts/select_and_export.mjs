import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';
import { selectAll, writeSelectionOutputs } from './lib/screening.mjs';

const usage = 'Usage: node scripts/select_and_export.mjs --config <json> --output <dir> --input <records.json> [--input <more.json>]';
const args = parseArgs(process.argv.slice(2), new Set(['input']));
requireArgs(args, ['config', 'output', 'input'], usage);
const config = JSON.parse(await fs.readFile(String(args.config), 'utf8'));
const inputPaths = Array.isArray(args.input) ? args.input : [args.input];
const records = [];

for (const inputPath of inputPaths) {
  const payload = JSON.parse(await fs.readFile(String(inputPath), 'utf8'));
  const incoming = Array.isArray(payload) ? payload : payload.records;
  if (!Array.isArray(incoming)) throw new Error(`Input has no records array: ${inputPath}`);
  records.push(...incoming);
}

const report = selectAll(records, config);
const outputDir = await writeSelectionOutputs(report, String(args.output));
console.log(JSON.stringify({
  outputDir,
  inputFiles: inputPaths.map((inputPath) => path.resolve(String(inputPath))),
  inputRecords: records.length,
  counts: Object.fromEntries(report.pools.map((pool) => [`${pool.group}_${pool.database}`, pool.selectedCount])),
}, null, 2));

