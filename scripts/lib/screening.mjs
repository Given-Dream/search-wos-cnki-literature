import fs from 'node:fs/promises';
import path from 'node:path';

const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;

function line(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isValidGroupId(value) {
  return /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u.test(line(value));
}

export function safeFileComponent(value) {
  const normalized = line(value);
  if (!isValidGroupId(normalized)) throw new Error(`Invalid group ID for output filename: ${value}`);
  return normalized;
}

export function normalizeDoi(value) {
  return line(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi\s*:\s*/i, '')
    .replace(/[\s.。；;，,]+$/g, '')
    .toLowerCase();
}

export function resolveCurrentYear(selection) {
  const configured = selection.currentYear;
  if (configured === undefined || configured === null || String(configured).toLowerCase() === 'auto') {
    return new Date().getFullYear();
  }
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 3000) throw new Error(`Invalid selection.currentYear: ${configured}`);
  return parsed;
}

function extractGbTYear(citation) {
  const match = line(citation).match(/\[J\][\s\S]*?[,，]\s*((?:19|20)\d{2})\s*[,，]/i);
  return Number(match?.[1] ?? 0) || 0;
}

function normalizeAuthors(authors) {
  if (Array.isArray(authors)) return authors.map(line).filter(Boolean).join('; ');
  return line(authors);
}

function deriveJournalTier(record, selection) {
  const explicit = number(record.journalTier, 0);
  if (explicit > 0) return explicit;
  if (record.database === 'WOS') {
    const quartile = line(record.jcrQuartile).toUpperCase().match(/^Q([1-4])$/);
    return quartile ? Number(quartile[1]) : 99;
  }
  const rules = selection.cnki?.journalTierRules ?? [];
  const haystack = [
    ...(Array.isArray(record.journalBadges) ? record.journalBadges : []),
    record.journalEvidence,
  ].map(line).join(' | ').toUpperCase();
  for (const rule of [...rules].sort((a, b) => number(a.tier, 99) - number(b.tier, 99))) {
    if ((rule.any ?? []).some((term) => haystack.includes(line(term).toUpperCase()))) return number(rule.tier, 99);
  }
  return number(selection.cnki?.fallbackJournalTier, 9);
}

export function normalizeRecord(record, selection, inputIndex = 0) {
  const database = line(record.database).toUpperCase();
  const group = line(record.group ?? record.label).toUpperCase();
  const formalYear = number(record.formalYear, 0)
    || (database === 'CNKI' ? extractGbTYear(record.citation) : 0)
    || number(record.year, 0);
  const normalized = {
    ...record,
    group,
    database,
    title: line(record.title),
    authors: normalizeAuthors(record.authors),
    doi: normalizeDoi(record.doi),
    sourceTitle: line(record.sourceTitle),
    documentType: line(record.documentType),
    webOfScienceIndex: line(record.webOfScienceIndex),
    year: number(record.year, 0),
    formalYear,
    citedCount: Math.max(0, number(record.citedCount, 0)),
    downloadCount: Math.max(0, number(record.downloadCount, 0)),
    relevanceScore: number(record.relevanceScore, -1),
    relevanceEvidence: line(record.relevanceEvidence),
    journalScore: number(record.journalScore, 0),
    journalEvidence: line(record.journalEvidence),
    journalBadges: Array.isArray(record.journalBadges) ? record.journalBadges.map(line).filter(Boolean) : [],
    _inputIndex: inputIndex,
  };
  normalized.journalTier = deriveJournalTier(normalized, selection);
  return normalized;
}

function baseFailure(record, selection) {
  if (!isValidGroupId(record.group)) return 'invalid-group';
  if (!['WOS', 'CNKI'].includes(record.database)) return 'invalid-database';
  if (!record.title) return 'missing-title';
  if (!record.authors) return 'missing-authors';
  if (!record.formalYear) return 'missing-formal-year';
  if (selection.requireDoi !== false && (!record.doi || !DOI_PATTERN.test(record.doi))) return 'missing-or-invalid-doi';
  if (record.relevanceScore < number(selection.minimumRelevanceScore, 0.8)) return 'below-relevance-threshold';
  if (selection.requireRelevanceEvidence !== false && !record.relevanceEvidence) return 'missing-relevance-evidence';
  if (selection.requireJournalEvidence !== false && !record.journalEvidence) return 'missing-journal-evidence';
  if (!Number.isFinite(record.journalTier) || record.journalTier <= 0 || record.journalTier >= 99) return 'missing-journal-tier';
  if (record.database === 'WOS') {
    const requiredType = line(selection.wos?.requiredDocumentType ?? 'Article').toLowerCase();
    if (!record.documentType.toLowerCase().includes(requiredType)) return 'wos-not-article';
    const requiredIndex = line(selection.wos?.requiredIndex ?? 'SCI-EXPANDED').toUpperCase();
    if (!record.webOfScienceIndex.toUpperCase().includes(requiredIndex)) return 'wos-not-sci-expanded';
  } else {
    const requiredType = line(selection.cnki?.requiredDocumentType ?? '期刊');
    if (record.documentType !== requiredType) return 'cnki-not-journal';
  }
  return '';
}

function topThreshold(records, metric, fraction) {
  const values = records.map((record) => number(record[metric], 0)).filter((value) => value > 0).sort((a, b) => b - a);
  if (!values.length) return null;
  const topCount = Math.max(1, Math.ceil(values.length * fraction));
  return values[Math.min(topCount, values.length) - 1];
}

export function compareCandidates(left, right) {
  return (left.journalTier - right.journalTier)
    || (right.journalScore - left.journalScore)
    || (right.relevanceScore - left.relevanceScore)
    || (right.formalYear - left.formalYear)
    || (right.citedCount - left.citedCount)
    || (right.downloadCount - left.downloadCount)
    || left.doi.localeCompare(right.doi, 'en')
    || (left._inputIndex - right._inputIndex);
}

function deduplicate(records, exclusions) {
  const sorted = [...records].sort(compareCandidates);
  const seen = new Set();
  const kept = [];
  for (const record of sorted) {
    if (seen.has(record.doi)) {
      exclusions.push({ doi: record.doi, title: record.title, reason: 'duplicate-doi' });
      continue;
    }
    seen.add(record.doi);
    kept.push(record);
  }
  return kept;
}

function timeDecision(record, database, currentYear, recentStart, thresholds) {
  if (record.formalYear > currentYear) return { allowed: false, reason: 'future-year' };
  if (record.formalYear >= recentStart) return { allowed: true, rule: 'recent-3-years' };
  if (database === 'WOS') {
    const threshold = thresholds.citedCount;
    if (threshold !== null && record.citedCount > 0 && record.citedCount >= threshold) {
      return {
        allowed: true,
        rule: 'older-high-impact-exception',
        detail: `WOS cited ${record.citedCount} >= top-fraction threshold ${threshold}`,
      };
    }
  } else {
    const citedPass = thresholds.citedCount !== null && record.citedCount > 0 && record.citedCount >= thresholds.citedCount;
    const downloadPass = thresholds.downloadCount !== null && record.downloadCount > 0 && record.downloadCount >= thresholds.downloadCount;
    if (citedPass || downloadPass) {
      const details = [];
      if (citedPass) details.push(`cited ${record.citedCount} >= ${thresholds.citedCount}`);
      if (downloadPass) details.push(`downloads ${record.downloadCount} >= ${thresholds.downloadCount}`);
      return { allowed: true, rule: 'older-high-impact-exception', detail: `CNKI ${details.join('; ')}` };
    }
  }
  return { allowed: false, reason: 'older-not-top-impact' };
}

function selectionReason(record) {
  const time = record.timeRule === 'recent-3-years'
    ? `formal year ${record.formalYear} is within the rolling window`
    : record.timeRuleDetail;
  return [
    `relevance ${record.relevanceScore.toFixed(2)} passed`,
    `journal tier ${record.journalTier}${record.journalScore ? `, score ${record.journalScore}` : ''}`,
    time,
  ].filter(Boolean).join('; ');
}

export function selectAll(rawRecords, config) {
  const selection = config.selection ?? config;
  const currentYear = resolveCurrentYear(selection);
  const recentYearSpan = Math.max(1, number(selection.recentYearSpan, 3));
  const recentStart = currentYear - recentYearSpan + 1;
  const maxPerPool = Math.max(1, number(selection.maxPerDatabaseGroup, 10));
  const topFraction = Math.min(1, Math.max(0.001, number(selection.olderExceptionTopFraction, 0.1)));
  const normalized = rawRecords.map((record, index) => normalizeRecord(record, selection, index));
  const configuredGroups = selection.groups;
  const groups = Array.isArray(configuredGroups) && configuredGroups.length
    ? configuredGroups.map((group) => line(group).toUpperCase())
    : [...new Set(normalized.map((record) => record.group).filter(isValidGroupId))].sort((left, right) => left.localeCompare(right));
  if (!groups.length) throw new Error('No valid strategy groups were found. Set selection.groups explicitly or provide grouped candidates.');
  const databases = (selection.databases ?? ['WOS', 'CNKI']).map((database) => line(database).toUpperCase());
  const pools = [];

  for (const group of groups) {
    for (const database of databases) {
      const poolRecords = normalized.filter((record) => record.group === group && record.database === database);
      const exclusions = [];
      const baseEligible = [];
      for (const record of poolRecords) {
        const reason = baseFailure(record, selection);
        if (reason) exclusions.push({ doi: record.doi, title: record.title, reason });
        else baseEligible.push(record);
      }
      const unique = deduplicate(baseEligible, exclusions);
      const thresholds = {
        citedCount: topThreshold(unique, 'citedCount', topFraction),
        downloadCount: database === 'CNKI' ? topThreshold(unique, 'downloadCount', topFraction) : null,
      };
      const timeEligible = [];
      for (const record of unique) {
        const decision = timeDecision(record, database, currentYear, recentStart, thresholds);
        if (!decision.allowed) {
          exclusions.push({ doi: record.doi, title: record.title, reason: decision.reason });
          continue;
        }
        const annotated = { ...record, timeRule: decision.rule, timeRuleDetail: decision.detail ?? '' };
        annotated.selectionReason = selectionReason(annotated);
        timeEligible.push(annotated);
      }
      const ranked = timeEligible.sort(compareCandidates);
      const selected = ranked.slice(0, maxPerPool).map((record, index) => ({ ...record, selectionRank: index + 1 }));
      for (const record of ranked.slice(maxPerPool)) {
        exclusions.push({ doi: record.doi, title: record.title, reason: 'ranked-below-journal-cutoff' });
      }
      pools.push({
        group,
        database,
        inputCount: poolRecords.length,
        baseEligibleCount: unique.length,
        timeEligibleCount: timeEligible.length,
        selectedCount: selected.length,
        thresholds,
        selected,
        exclusions,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    policy: {
      currentYear,
      recentStart,
      recentYearSpan,
      maxPerPool,
      minimumRelevanceScore: number(selection.minimumRelevanceScore, 0.8),
      olderExceptionTopFraction: topFraction,
      groups,
      databases,
    },
    pools,
  };
}

function renderRecord(record, index) {
  return [
    `[${index + 1}]`,
    `Title: ${line(record.title)}`,
    `Year: ${record.formalYear}`,
    `Authors: ${line(record.authors)}`,
    `DOI: ${record.doi}`,
    `Source: ${line(record.sourceTitle)}`,
    `Database: ${record.database}`,
    `Journal Level: Tier ${record.journalTier}`,
    `Journal Evidence: ${line(record.journalEvidence)}`,
    `Relevance Score: ${record.relevanceScore.toFixed(2)}`,
    `Cited By: ${record.citedCount}`,
    `Downloads: ${record.downloadCount}`,
    `Time Rule: ${record.timeRule}`,
    `Selection Reason: ${line(record.selectionReason)}`,
    '---',
  ].join('\n');
}

export function renderTxt(records) {
  const body = records.length
    ? records.map(renderRecord).join('\n')
    : '# No qualifying records under the configured policy.\n';
  return `\uFEFF${body}\n`;
}

function thresholdText(value) {
  return value === null ? '无正值，旧文不适用该指标例外' : String(value);
}

export function renderSummary(report) {
  const lines = [
    'WOS/CNKI 分组筛选说明与数量核验',
    '',
    `执行年份: ${report.policy.currentYear}`,
    `近三年窗口: ${report.policy.recentStart}–${report.policy.currentYear}`,
    `每库每组上限: ${report.policy.maxPerPool}`,
    `最低相关性分数: ${report.policy.minimumRelevanceScore}`,
    `旧文高影响例外比例: 前 ${(report.policy.olderExceptionTopFraction * 100).toFixed(0)}%（同库同组候选池）`,
    '',
    '筛选顺序: 相关性与必备字段 → 文献类型/索引 → 年份或高影响例外 → 期刊等级与指标排序 → DOI 稳定决胜。',
    'WOS 与 CNKI 独立取数，不设任意 5+5 配额。WOS 的 SCI-EXPANDED 不等同于 JCR Q1。',
    '',
  ];
  for (const pool of report.pools) {
    lines.push(`${pool.group}_${pool.database}: 输入 ${pool.inputCount}；基本合格 ${pool.baseEligibleCount}；年份合格 ${pool.timeEligibleCount}；入选 ${pool.selectedCount}`);
    lines.push(`  引用阈值: ${thresholdText(pool.thresholds.citedCount)}；下载阈值: ${thresholdText(pool.thresholds.downloadCount)}`);
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

export async function writeSelectionOutputs(report, outputDir) {
  const resolved = path.resolve(outputDir);
  await fs.mkdir(resolved, { recursive: true });
  for (const pool of report.pools) {
    const groupName = safeFileComponent(pool.group);
    await fs.writeFile(path.join(resolved, `${groupName}_${pool.database}.txt`), renderTxt(pool.selected), 'utf8');
  }
  await fs.writeFile(path.join(resolved, '筛选说明与数量核验.txt'), renderSummary(report), 'utf8');
  await fs.writeFile(path.join(resolved, 'selection-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return resolved;
}

export function isPlausibleDoi(value) {
  return DOI_PATTERN.test(normalizeDoi(value));
}
