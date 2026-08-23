import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, requireArgs } from './lib/cli.mjs';
import { isValidGroupId, safeFileComponent } from './lib/screening.mjs';

function detectDatabase(text) {
  if (/web\s*of\s*science|webofscience|\bwos\b/i.test(text)) return 'WOS';
  if (/\bcnki\b|中国知网|知网/i.test(text)) return 'CNKI';
  return '';
}

function detectGroup(text) {
  const explicit = text.match(/(?:^|\s)(?:group|组)\s*[:：]\s*([\p{L}\p{N}][\p{L}\p{N}_.-]{0,63})(?:\s|$)/iu);
  if (explicit) return explicit[1];
  const cleaned = text.replace(/^\d+(?:\.\d+)*[.)、:]?\s*/, '').trim();
  const leading = cleaned.match(/^([\p{L}\p{N}][\p{L}\p{N}_.-]{0,63})(?:\s+|$)/u);
  return leading?.[1] ?? '';
}

function parseStrategy(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const blocks = [];
  const meanings = new Map();
  let database = '';
  let group = '';
  let inFence = false;
  let captureDatabase = '';
  let captureGroup = '';
  let code = [];

  for (const sourceLine of lines) {
    const fence = sourceLine.match(/^\s*```\s*([^\s`]*)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        const fenceDatabase = detectDatabase(fence[1]);
        captureDatabase = fenceDatabase || database;
        captureGroup = group;
        code = [];
      } else {
        const query = code.join('\n').trim();
        if (query && captureDatabase && captureGroup) {
          blocks.push({ database: captureDatabase, group: captureGroup, query });
        }
        inFence = false;
        captureDatabase = '';
        captureGroup = '';
        code = [];
      }
      continue;
    }
    if (inFence) {
      code.push(sourceLine);
      continue;
    }

    const commentGroup = sourceLine.match(/<!--\s*group\s*:\s*([\p{L}\p{N}][\p{L}\p{N}_.-]{0,63})\s*-->/iu);
    if (commentGroup) {
      group = commentGroup[1].toUpperCase();
      continue;
    }
    const heading = sourceLine.match(/^#{1,6}\s+(.+?)\s*$/);
    if (!heading) continue;
    const headingText = heading[1].trim();
    const headingDatabase = detectDatabase(headingText);
    if (headingDatabase) {
      database = headingDatabase;
      continue;
    }
    const candidate = detectGroup(headingText);
    if (candidate && isValidGroupId(candidate)) {
      group = candidate.toUpperCase();
      const meaning = headingText.slice(candidate.length).trim().replace(/^[-–—:：]+\s*/, '');
      if (meaning && !meanings.has(group)) meanings.set(group, meaning);
    }
  }
  if (inFence) throw new Error('The strategy contains an unclosed fenced code block.');
  return { blocks, meanings };
}

const usage = 'Usage: node scripts/extract_strategy.mjs --strategy <strategy.md> --output <run-dir> [--config-template <default.json>]';
const args = parseArgs(process.argv.slice(2));
requireArgs(args, ['strategy', 'output'], usage);
const strategyPath = path.resolve(String(args.strategy));
const outputDir = path.resolve(String(args.output));
const queryDir = path.join(outputDir, 'queries');
const markdown = await fs.readFile(strategyPath, 'utf8');
const { blocks, meanings } = parseStrategy(markdown);
if (!blocks.length) {
  throw new Error('No query blocks were extracted. Use WOS/CNKI headings, group headings, and fenced query blocks, or normalize the strategy manually.');
}

await fs.mkdir(queryDir, { recursive: true });
const map = { sourceStrategy: strategyPath, groups: {} };
const counters = new Map();
for (const block of blocks) {
  const group = safeFileComponent(block.group);
  const key = `${group}\u0000${block.database}`;
  const index = (counters.get(key) ?? 0) + 1;
  counters.set(key, index);
  const filename = `${group}_${block.database}_${index}.txt`;
  await fs.writeFile(path.join(queryDir, filename), `${block.query}\n`, 'utf8');
  map.groups[group] ??= { meaning: meanings.get(group) ?? '', WOS: [], CNKI: [] };
  map.groups[group][block.database].push(`queries/${filename}`);
}

const groups = Object.keys(map.groups).sort((left, right) => left.localeCompare(right));
await fs.writeFile(path.join(outputDir, 'queries.json'), `${JSON.stringify(map, null, 2)}\n`, 'utf8');
if (args['config-template']) {
  const config = JSON.parse(await fs.readFile(String(args['config-template']), 'utf8'));
  config.selection ??= {};
  config.selection.groups = groups;
  await fs.writeFile(path.join(outputDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({
  strategy: strategyPath,
  outputDir,
  groups,
  queryBlocks: blocks.length,
  pairs: Object.fromEntries(groups.map((group) => [group, {
    WOS: map.groups[group].WOS.length,
    CNKI: map.groups[group].CNKI.length,
  }])),
}, null, 2));

