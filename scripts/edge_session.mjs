import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './lib/cli.mjs';
import { loadChromium } from './lib/playwright.mjs';

const args = parseArgs(process.argv.slice(2));
const edgePath = String(args['edge-path'] ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
const profileDir = path.resolve(String(args['profile-dir'] ?? '.edge-wos-cnki-profile'));
const port = Number(args.port ?? 9333);
const startUrl = String(args['start-url'] ?? 'https://webofscience.clarivate.cn/wos/woscc/advanced-search');

if (!fs.existsSync(edgePath)) throw new Error(`Microsoft Edge was not found at: ${edgePath}`);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid CDP port: ${port}`);

const chromium = await loadChromium();
const context = await chromium.launchPersistentContext(profileDir, {
  executablePath: edgePath,
  headless: false,
  viewport: null,
  args: [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
  ],
});

const page = context.pages()[0] ?? await context.newPage();
if (page.url() === 'about:blank') {
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
}

console.log(JSON.stringify({
  status: 'ready',
  browser: 'Microsoft Edge',
  debuggerUrl: `http://127.0.0.1:${port}`,
  profileDir,
  pageUrl: page.url(),
  note: 'Complete login, institutional authentication, consent, or CAPTCHA manually in the visible window.',
}, null, 2));

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await context.close().catch(() => {});
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
await new Promise((resolve) => context.once('close', resolve));

