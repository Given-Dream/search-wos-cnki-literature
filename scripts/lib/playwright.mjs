import path from 'node:path';
import { pathToFileURL } from 'node:url';

function bundledPlaywrightCandidates() {
  const executableNodeModules = path.resolve(path.dirname(process.execPath), '..', 'node_modules');
  const roots = [
    executableNodeModules,
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules')
      : '',
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules')
      : '',
    process.env.CODEX_NODE_MODULES,
  ].filter(Boolean);
  return roots.map((root) => pathToFileURL(path.join(root, 'playwright', 'index.mjs')).href);
}

export async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_URL,
    'playwright',
    ...bundledPlaywrightCandidates(),
  ].filter(Boolean);
  const failures = [];
  for (const candidate of [...new Set(candidates)]) {
    try {
      const loaded = await import(candidate);
      if (loaded.chromium) return loaded.chromium;
      failures.push(`${candidate}: module has no chromium export`);
    } catch (error) {
      failures.push(`${candidate}: ${error?.message ?? error}`);
    }
  }
  throw new Error(
    `Playwright could not be loaded. Install playwright or set PLAYWRIGHT_MODULE_URL to its index.mjs URL.\n${failures.join('\n')}`,
  );
}

