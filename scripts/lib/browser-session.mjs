import path from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function normalizeLoopbackCdpUrl(value = 'http://127.0.0.1:9333') {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error(`Invalid CDP URL: ${value}`);
  }
  if (parsed.protocol !== 'http:') throw new Error('CDP URL must use http://.');
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) throw new Error('CDP URL must use a loopback host.');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('CDP URL must not contain credentials, query parameters, or fragments.');
  }
  return parsed.origin;
}

export function validateBrowserTarget(value, { allowInsecureHttp = false, field = 'target URL' } = {}) {
  if (value === 'about:blank') return value;
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error(`Invalid ${field}: ${value}`);
  }
  if (parsed.protocol === 'https:') return parsed.href;
  if (parsed.protocol === 'http:' && allowInsecureHttp) return parsed.href;
  throw new Error(`Refusing non-HTTPS ${field}: ${value}`);
}

export function buildExternalEdgeArgs({ profileDir, port, startUrls = [], allowInsecureHttp = false }) {
  const normalizedPort = Number(port);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1024 || normalizedPort > 65535) {
    throw new Error(`Invalid CDP port: ${port}`);
  }
  const resolvedProfileDir = path.resolve(String(profileDir));
  const normalizedUrls = startUrls.map((value) => validateBrowserTarget(value, {
    allowInsecureHttp,
    field: 'Edge start URL',
  }));
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${normalizedPort}`,
    `--user-data-dir=${resolvedProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    ...normalizedUrls,
  ];
}

export function classifyAccessPage({ status, finalUrl = '', title = '', bodyText = '' }) {
  const combined = `${title}\n${bodyText}`;
  let finalHost = '';
  try { finalHost = new URL(finalUrl).hostname; } catch {}
  if (finalHost === 'qikan.cqvip.com' && [403, 412].includes(Number(status))) {
    return 'automation-restricted';
  }
  if (/\/(?:page-not-found|404)(?:[/?#]|$)/i.test(finalUrl)
    || /^(?:page not found|404(?:\s|$)|页面不存在|未找到页面)/i.test(title.trim())) {
    return 'route-not-found';
  }
  if (/\/(?:crawlprevention|challenge|captcha|verify)(?:[/?#]|$)/i.test(finalUrl)
    || /captcha|人机验证|安全验证|请稍候|verify you are human|checking your browser|cloudflare/i.test(combined)) {
    return 'verification-required';
  }
  if (/^(?:account|login|sso|auth)\./i.test(finalHost)
    || /\b(?:login|log-in|sign-in|signin|sso|oauth)\b/i.test(finalUrl)
    || /^(?:login|sign in|用户登录|登录)(?:\s|$)/i.test(title.trim())) {
    return 'authentication-required';
  }
  if (/access denied|forbidden|拒绝访问|无权访问|权限不足/i.test(combined)) return 'access-denied';
  if (Number(status) >= 400) return `http-${status}`;
  return 'landing-reachable';
}

export function classifyCqvipPage({ finalUrl = '', title = '', bodyText = '', searchInputVisible = false }) {
  const combined = `${title}\n${bodyText}`;
  let finalHost = '';
  try { finalHost = new URL(finalUrl).hostname; } catch {}
  if (/\b(?:403|412)\b|precondition failed|forbidden|访问异常|请求异常/i.test(combined)) {
    return 'automation-restricted';
  }
  if (/captcha|人机验证|安全验证|滑块|请完成验证/i.test(combined)
    || /\b(?:login|sign-in|signin|oauth)\b/i.test(finalUrl)
    || /用户登录|账号登录|请登录/i.test(combined)) {
    return 'manual-action-required';
  }
  if (finalHost === 'qikan.cqvip.com' && searchInputVisible) return 'ready';
  if (finalHost && finalHost !== 'qikan.cqvip.com') return 'unexpected-host';
  return 'not-ready';
}
