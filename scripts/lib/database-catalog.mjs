import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DATABASE_CATALOG = path.resolve(moduleDir, '..', '..', 'config', 'database-catalog.json');

const QUERY_CAPABILITIES = new Set(['boolean', 'keyword-batches']);
const BOOLEAN_SUBMISSIONS = new Set(['collector', 'query-url', 'advanced-form', 'visible-search-box']);

function normalizeLookup(value) {
  return String(value ?? '').trim().toLocaleLowerCase('en-US');
}

export function normalizeCatalogQuery(value) {
  return String(value ?? '').trim().replace(/\s+/gu, ' ');
}

export function looksLikeBooleanExpression(value) {
  const query = normalizeCatalogQuery(value);
  return /(?:^|[\s(])(?:AND|OR|NOT)(?=$|[\s)])/u.test(query)
    || /\s[+*]\s/u.test(query);
}

function requireWebUrl(value, field, id, { allowInsecureHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value ?? ''));
  } catch {
    throw new Error(`Database ${id} has an invalid ${field}: ${value}`);
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && allowInsecureHttp) return;
  throw new Error(`Database ${id} must use HTTPS for ${field} unless allowInsecureHttp is explicitly true.`);
}

export function validateDatabaseCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') throw new Error('Database catalog must be a JSON object.');
  if (!Number.isInteger(catalog.schemaVersion) || catalog.schemaVersion < 2) {
    throw new Error('Database catalog requires schemaVersion 2 or newer.');
  }
  if (!Array.isArray(catalog.databases) || !catalog.databases.length) {
    throw new Error('Database catalog must contain at least one database.');
  }

  const numbers = new Set();
  const ids = new Set();
  const lookups = new Map();
  const ordered = [...catalog.databases].sort((left, right) => left.number - right.number);
  let reachedKeywordGroup = false;

  for (let index = 0; index < ordered.length; index += 1) {
    const database = ordered[index];
    const expectedNumber = index + 1;
    if (database.number !== expectedNumber) {
      throw new Error(`Database numbers must be consecutive from 1; expected ${expectedNumber}, got ${database.number}.`);
    }
    if (numbers.has(database.number)) throw new Error(`Duplicate database number: ${database.number}`);
    numbers.add(database.number);

    const id = String(database.id ?? '');
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid database id: ${id}`);
    if (ids.has(id)) throw new Error(`Duplicate database id: ${id}`);
    ids.add(id);

    if (!String(database.label ?? '').trim()) throw new Error(`Database ${id} requires a label.`);
    if (database.allowInsecureHttp !== undefined && typeof database.allowInsecureHttp !== 'boolean') {
      throw new Error(`Database ${id} allowInsecureHttp must be boolean.`);
    }
    const allowInsecureHttp = database.allowInsecureHttp === true;
    requireWebUrl(database.launchUrl, 'launchUrl', id, { allowInsecureHttp });
    if (database.whlibUrl) requireWebUrl(database.whlibUrl, 'whlibUrl', id, { allowInsecureHttp });
    if (database.capabilityEvidence) {
      requireWebUrl(database.capabilityEvidence, 'capabilityEvidence', id, { allowInsecureHttp });
    } else {
      throw new Error(`Database ${id} requires capabilityEvidence.`);
    }
    if (database.searchUrlTemplate) {
      requireWebUrl(database.searchUrlTemplate.replace('{query}', 'test'), 'searchUrlTemplate', id, { allowInsecureHttp });
      if (!database.searchUrlTemplate.includes('{query}')) {
        throw new Error(`Database ${id} searchUrlTemplate must contain {query}.`);
      }
    }
    if (!['scripted-collector', 'query-url', 'browser-assisted'].includes(database.retrievalMode)) {
      throw new Error(`Database ${id} has an unsupported retrievalMode: ${database.retrievalMode}`);
    }
    if (database.retrievalMode === 'query-url' && !database.searchUrlTemplate) {
      throw new Error(`Database ${id} uses query-url but has no searchUrlTemplate.`);
    }

    if (!QUERY_CAPABILITIES.has(database.queryCapability)) {
      throw new Error(`Database ${id} has an unsupported queryCapability: ${database.queryCapability}`);
    }
    if (!String(database.queryDialect ?? '').trim()) {
      throw new Error(`Database ${id} requires a queryDialect description.`);
    }
    if (database.queryCapability === 'boolean') {
      if (reachedKeywordGroup) {
        throw new Error(`Boolean-capable database ${id} must be numbered before all keyword-batch databases.`);
      }
      if (!BOOLEAN_SUBMISSIONS.has(database.booleanSubmission)) {
        throw new Error(`Database ${id} requires a supported booleanSubmission mode.`);
      }
      if (database.booleanSubmission === 'query-url' && !database.searchUrlTemplate) {
        throw new Error(`Database ${id} uses Boolean query-url submission but has no searchUrlTemplate.`);
      }
    } else {
      reachedKeywordGroup = true;
      if (database.booleanSubmission !== undefined) {
        throw new Error(`Keyword-batch database ${id} must not declare booleanSubmission.`);
      }
    }

    const aliases = [database.id, database.label, ...(database.aliases ?? [])];
    for (const alias of aliases) {
      const key = normalizeLookup(alias);
      if (!key) continue;
      const known = lookups.get(key);
      if (known && known !== id) throw new Error(`Database alias "${alias}" is ambiguous between ${known} and ${id}.`);
      lookups.set(key, id);
    }
  }

  if (!Array.isArray(catalog.defaultSelection) || !catalog.defaultSelection.length) {
    throw new Error('Database catalog requires a non-empty defaultSelection.');
  }
  for (const id of catalog.defaultSelection) {
    if (!ids.has(id)) throw new Error(`Default database is missing from catalog: ${id}`);
  }

  return catalog;
}

export async function loadDatabaseCatalog(filePath = DEFAULT_DATABASE_CATALOG) {
  const resolved = path.resolve(String(filePath));
  const catalog = JSON.parse(await fs.readFile(resolved, 'utf8'));
  validateDatabaseCatalog(catalog);
  return { ...catalog, catalogPath: resolved };
}

export function defaultDatabases(catalog) {
  const wanted = new Set(catalog.defaultSelection);
  return catalog.databases.filter((database) => wanted.has(database.id));
}

function databaseLookup(catalog) {
  const byNumber = new Map();
  const byAlias = new Map();
  for (const database of catalog.databases) {
    byNumber.set(database.number, database);
    for (const value of [database.id, database.label, ...(database.aliases ?? [])]) {
      byAlias.set(normalizeLookup(value), database);
    }
  }
  return { byNumber, byAlias };
}

function expandSelectionToken(token) {
  const range = token.match(/^(\d+)\s*[-–—]\s*(\d+)$/u);
  if (!range) return [token];
  const start = Number(range[1]);
  const end = Number(range[2]);
  if (start > end) throw new Error(`Database range must be ascending: ${token}`);
  if (end - start > 100) throw new Error(`Database range is too large: ${token}`);
  return Array.from({ length: end - start + 1 }, (_, offset) => String(start + offset));
}

export function parseDatabaseSelection(value, catalog) {
  const source = String(value ?? '').trim();
  if (!source) throw new Error('Database selection is empty. Pass one or more numbers or database IDs.');
  const rawTokens = source.split(/[,，;；\s]+/u).filter(Boolean);
  const tokens = rawTokens.flatMap(expandSelectionToken);
  const normalizedTokens = tokens.map(normalizeLookup);
  const defaultTokens = new Set(['0', 'default', '默认']);
  const usesDefault = normalizedTokens.some((token) => defaultTokens.has(token));
  if (usesDefault) {
    if (normalizedTokens.length !== 1) throw new Error('Default selection (0) cannot be combined with other databases.');
    return defaultDatabases(catalog);
  }

  const { byNumber, byAlias } = databaseLookup(catalog);
  const selected = new Set();
  for (const token of tokens) {
    const number = /^\d+$/.test(token) ? Number(token) : NaN;
    const database = Number.isInteger(number) ? byNumber.get(number) : byAlias.get(normalizeLookup(token));
    if (!database) throw new Error(`Unknown database selection: ${token}`);
    selected.add(database.id);
  }
  return catalog.databases.filter((database) => selected.has(database.id));
}

export function buildDatabaseTarget(database, query = '', { queryType = 'none' } = {}) {
  const normalizedQuery = normalizeCatalogQuery(query);
  if (!normalizedQuery) {
    return {
      url: database.launchUrl,
      queryApplied: false,
      queryPending: false,
      queryType: 'none',
      queryInputMode: 'none',
    };
  }

  const expectedType = database.queryCapability === 'boolean' ? 'boolean' : 'keyword';
  if (queryType !== expectedType) {
    const requiredFlag = expectedType === 'boolean' ? '--boolean-query' : '--keyword-query';
    throw new Error(`Database ${database.id} requires ${requiredFlag}; query capability is ${database.queryCapability}.`);
  }
  if (queryType === 'boolean' && !looksLikeBooleanExpression(normalizedQuery)) {
    throw new Error(`Database ${database.id} supports Boolean search. Provide an explicit site-specific expression containing AND, OR, NOT, +, or *.`);
  }
  if (queryType === 'keyword' && looksLikeBooleanExpression(normalizedQuery)) {
    throw new Error(`Database ${database.id} is routed as keyword batches. Do not paste a Boolean expression into its keyword input.`);
  }

  const queryApplied = Boolean(
    database.searchUrlTemplate
    && (database.queryCapability === 'keyword-batches' || database.booleanSubmission === 'query-url'),
  );
  return {
    url: queryApplied
      ? database.searchUrlTemplate.replace('{query}', encodeURIComponent(normalizedQuery))
      : database.launchUrl,
    queryApplied,
    queryPending: !queryApplied,
    queryType,
    queryInputMode: database.queryCapability === 'boolean'
      ? database.booleanSubmission
      : (database.searchUrlTemplate ? 'query-url' : 'keyword-form'),
  };
}

function retrievalLabel(database) {
  if (database.retrievalMode === 'scripted-collector') return '自动采集';
  if (database.retrievalMode === 'query-url') return '检索链接';
  return '浏览器辅助';
}

export function formatDatabaseMenu(catalog) {
  const defaultLabels = defaultDatabases(catalog).map((database) => `${database.number} ${database.label}`).join(' + ');
  const booleanDatabases = catalog.databases.filter((database) => database.queryCapability === 'boolean');
  const keywordDatabases = catalog.databases.filter((database) => database.queryCapability === 'keyword-batches');
  const lines = [
    `0. 默认：${defaultLabels}`,
    '【可构建布尔高级检索式：必须使用各库专用布尔逻辑】',
  ];
  for (const database of booleanDatabases) {
    lines.push(`${database.number}. ${database.label}（布尔检索；${retrievalLabel(database)}）`);
  }
  lines.push('【不构建布尔表达式：关键词/字段分批检索后合并去重】');
  if (!keywordDatabases.length) lines.push('（暂无）');
  for (const database of keywordDatabases) {
    lines.push(`${database.number}. ${database.label}（关键词分批；${retrievalLabel(database)}）`);
  }
  return lines.join('\n');
}

export function makeSelectionPlan(
  catalog,
  databases,
  {
    mode,
    booleanQuery = '',
    keywordQuery = '',
  } = {},
) {
  if (!Array.isArray(databases) || !databases.length) throw new Error('Selection plan requires at least one database.');
  const normalizedBooleanQuery = normalizeCatalogQuery(booleanQuery);
  const normalizedKeywordQuery = normalizeCatalogQuery(keywordQuery);
  if (normalizedBooleanQuery && normalizedKeywordQuery) {
    throw new Error('Use either a database-specific --boolean-query or --keyword-query, not both.');
  }
  const query = normalizedBooleanQuery || normalizedKeywordQuery;
  const queryType = normalizedBooleanQuery ? 'boolean' : (normalizedKeywordQuery ? 'keyword' : 'none');
  if (query && databases.length !== 1) {
    throw new Error('A query is database-specific. Select exactly one database, or create the plan without a query and build one query per database.');
  }

  return {
    schemaVersion: 2,
    mode: mode ?? 'custom',
    catalogPath: catalog.catalogPath ?? '',
    catalogSource: catalog.source ?? {},
    query,
    queryType,
    queryPolicy: queryType === 'boolean'
      ? 'Use the selected database dialect; never downgrade this expression to plain keywords.'
      : (queryType === 'keyword'
        ? 'Run separate keyword/field searches and merge/deduplicate results; never paste a Boolean expression.'
        : 'No query supplied; build a separate query that matches each selected database capability.'),
    databases: databases.map((database) => {
      const target = buildDatabaseTarget(database, query, { queryType });
      return {
        number: database.number,
        id: database.id,
        label: database.label,
        kind: database.kind,
        retrievalMode: database.retrievalMode,
        queryCapability: database.queryCapability,
        booleanSubmission: database.booleanSubmission ?? '',
        queryDialect: database.queryDialect,
        capabilityEvidence: database.capabilityEvidence,
        collector: database.collector ?? '',
        automationScript: database.automationScript ?? '',
        requiresPersistentProfile: Boolean(database.requiresPersistentProfile),
        allowInsecureHttp: Boolean(database.allowInsecureHttp),
        launchUrl: database.launchUrl,
        targetUrl: target.url,
        queryApplied: target.queryApplied,
        queryPending: target.queryPending,
        queryType: target.queryType,
        queryInputMode: target.queryInputMode,
      };
    }),
  };
}
