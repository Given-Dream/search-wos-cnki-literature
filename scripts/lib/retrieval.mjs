const CNKI_TRANSIENT_PATTERN = /(?:请稍后重试|服务繁忙|网络(?:异常|错误)|加载(?:失败|异常)|请求(?:失败|异常)|系统(?:繁忙|异常)|抱歉[\s\S]{0,30}暂无数据)/i;
const CNKI_EXPLICIT_EMPTY_PATTERN = /(?:共找到\s*0\s*条结果|未检索到(?:相关)?(?:文献|结果)|没有找到(?:相关)?(?:文献|结果)|检索结果(?:数)?\s*(?:为|是|[:：])?\s*0)/i;

export function normalizeQueryWhitespace(value) {
  const source = String(value ?? '').replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  let rendered = '';
  let quote = '';
  let escaped = false;
  let pendingSpace = false;

  for (const character of source) {
    if (quote) {
      rendered += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }

    if (character === '"' || character === "'") {
      if (pendingSpace && rendered && !rendered.endsWith(' ')) rendered += ' ';
      pendingSpace = false;
      quote = character;
      rendered += character;
      continue;
    }

    if (/\s/u.test(character)) {
      pendingSpace = Boolean(rendered);
      continue;
    }

    if (pendingSpace && rendered && !rendered.endsWith(' ')) rendered += ' ';
    pendingSpace = false;
    rendered += character;
  }

  return rendered.trim();
}

export function normalizeDatabaseQuery(value, database = '') {
  const normalized = normalizeQueryWhitespace(value);
  if (!normalized) throw new Error(`${String(database || 'database').toUpperCase()} query is empty after normalization.`);
  return normalized;
}

export function parseCnkiResultCount(bodyText) {
  const match = String(bodyText ?? '').match(/共找到\s*([\d,]+)\s*条结果/i);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

export function parseWosResultCount(bodyText) {
  const text = String(bodyText ?? '');
  const match = text.match(/([\d,]+)\s+results from Web of Science Core Collection/i)
    ?? text.match(/([\d,]+)\s+records matched your query/i);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

export function rectIntersectsViewport(rect, viewport) {
  if (!rect || !viewport) return false;
  const width = Number(rect.width ?? 0);
  const height = Number(rect.height ?? 0);
  const left = Number(rect.left ?? 0);
  const top = Number(rect.top ?? 0);
  const right = Number(rect.right ?? left + width);
  const bottom = Number(rect.bottom ?? top + height);
  const viewportWidth = Number(viewport.width ?? 0);
  const viewportHeight = Number(viewport.height ?? 0);
  return width > 0
    && height > 0
    && viewportWidth > 0
    && viewportHeight > 0
    && right > 0
    && bottom > 0
    && left < viewportWidth
    && top < viewportHeight;
}

export function classifyCnkiSnapshot(snapshot) {
  const bodyText = String(snapshot?.bodyText ?? '');
  const parsedCount = snapshot?.resultCount ?? parseCnkiResultCount(bodyText);
  const resultCount = parsedCount === null || parsedCount === undefined ? null : Number(parsedCount);
  const rowCount = Math.max(0, Number(snapshot?.rowCount ?? 0));

  if (rowCount > 0) {
    return { kind: 'results', resultCount: Math.max(rowCount, resultCount ?? 0), rowCount };
  }
  if (snapshot?.captchaVisible && !(resultCount > 0)) {
    return { kind: 'manual-verification', resultCount, rowCount };
  }
  if (CNKI_TRANSIENT_PATTERN.test(bodyText)) {
    return { kind: 'transient-error', resultCount, rowCount };
  }
  if (resultCount > 0) {
    return { kind: 'loading-results', resultCount, rowCount };
  }
  if (resultCount === 0 || CNKI_EXPLICIT_EMPTY_PATTERN.test(bodyText)) {
    return { kind: 'confirmed-empty-candidate', resultCount: 0, rowCount };
  }
  return { kind: 'indeterminate', resultCount, rowCount };
}

