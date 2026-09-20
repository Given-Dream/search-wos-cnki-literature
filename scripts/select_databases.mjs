import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './lib/cli.mjs';
import {
  defaultDatabases,
  formatDatabaseMenu,
  loadDatabaseCatalog,
  makeSelectionPlan,
  parseDatabaseSelection,
} from './lib/database-catalog.mjs';

const usage = `Usage:
  node scripts/select_databases.mjs --list
  node scripts/select_databases.mjs --default [--output <json>]
  node scripts/select_databases.mjs --selection <numbers-or-ids> [--boolean-query <site-specific-expression>|--keyword-query <text>] [--output <json>]`;

const args = parseArgs(process.argv.slice(2));
const catalog = await loadDatabaseCatalog(args.catalog);

if (args.list || (args.default === undefined && args.selection === undefined)) {
  console.log('是否使用默认的 WOS + 知网完整采集？');
  console.log('如不使用默认完整采集，请从下列编号中选择；可用逗号或升序范围选择多个库。布尔组必须使用各库专用布尔表达式。');
  console.log(formatDatabaseMenu(catalog));
  if (args.default === undefined && args.selection === undefined) process.exit(0);
}

if (args.default !== undefined && args.selection !== undefined) {
  throw new Error(`Choose either --default or --selection, not both.\n${usage}`);
}

let databases;
let mode;
if (args.default !== undefined) {
  if (args.default !== true && !/^(?:1|true|yes|是)$/iu.test(String(args.default))) {
    throw new Error(`--default is a flag and does not accept "${args.default}".\n${usage}`);
  }
  databases = defaultDatabases(catalog);
  mode = 'default';
} else if (args.selection !== undefined) {
  databases = parseDatabaseSelection(args.selection, catalog);
  mode = 'custom';
} else {
  throw new Error(usage);
}

if (args.query !== undefined) {
  throw new Error('Generic --query is disabled. Use --boolean-query for a Boolean-capable database or --keyword-query for a keyword-batch database.');
}

const plan = makeSelectionPlan(catalog, databases, {
  mode,
  booleanQuery: args['boolean-query'] ?? '',
  keywordQuery: args['keyword-query'] ?? '',
});
if (args.output) {
  const outputPath = path.resolve(String(args.output));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
  plan.output = outputPath;
}

console.log(JSON.stringify(plan, null, 2));
