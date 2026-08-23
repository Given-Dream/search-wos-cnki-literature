import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';

function parseRecord(block, group, sourceFile) {
  const fields = {};
  let current = '';
  for (const line of block.split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9]) (.*)$/);
    if (match) {
      current = match[1];
      fields[current] ??= [];
      fields[current].push(match[2].trim());
    } else if (/^\s{3}/.test(line) && current) {
      fields[current].push(line.trim());
    }
  }
  return {
    group,
    database: 'WOS',
    title: fields.TI?.join(' ') ?? '',
    year: Number(fields.PY?.[0] ?? 0) || '',
    formalYear: Number(fields.PY?.[0] ?? 0) || '',
    authors: fields.AF?.length ? fields.AF : (fields.AU ?? []),
    doi: fields.DI?.[0] ?? '',
    sourceTitle: fields.SO?.join(' ') ?? '',
    documentType: fields.DT?.join('; ') ?? '',
    webOfScienceIndex: fields.WE?.join('; ') ?? '',
    categories: fields.WC?.join('; ') ?? '',
    citedCount: Number(fields.TC?.[0] ?? 0),
    downloadCount: 0,
    wosId: fields.UT?.[0] ?? '',
    abstract: fields.AB?.join(' ') ?? '',
    issn: fields.SN?.[0] ?? fields.EI?.[0] ?? '',
    rawSourceFile: sourceFile,
  };
}

const usage = 'Usage: node scripts/parse_wos_export.mjs <field-tagged.txt> --group <GROUP_ID> [--output records.json]';
const args = parseArgs(process.argv.slice(2));
requireArgs(args, ['group'], usage);
if (!args._.length) throw new Error(usage);
const inputPath = path.resolve(args._[0]);
const text = (await fs.readFile(inputPath, 'utf8')).replaceAll('\r\n', '\n');
const blocks = text.split(/\nER\s*\n/).filter((block) => /(?:^|\n)TI /.test(block));
const records = blocks.map((block) => parseRecord(block, String(args.group).toUpperCase(), inputPath));
const payload = {
  group: String(args.group).toUpperCase(),
  database: 'WOS',
  sourceFile: inputPath,
  count: records.length,
  records,
};
const rendered = `${JSON.stringify(payload, null, 2)}\n`;
if (args.output) {
  await fs.mkdir(path.dirname(path.resolve(String(args.output))), { recursive: true });
  await fs.writeFile(String(args.output), rendered, 'utf8');
}
console.log(rendered.trimEnd());
