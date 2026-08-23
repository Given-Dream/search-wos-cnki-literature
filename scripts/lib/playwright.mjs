const BUNDLED_PLAYWRIGHT = 'file:///C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

export async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE_URL,
    'playwright',
    BUNDLED_PLAYWRIGHT,
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

