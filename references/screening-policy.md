# Screening policy

## Unit of selection

Confirm the retention choice with the user before searching. For `selection.maxPerDatabaseGroup`, use the user's positive integer limit or `"all"`. Apply it independently to each `(group, database)` pair. In all mode, retain every unique collected record that passes the agreed screening criteria. Year, publication type, relevance, and required fields come from the agreed screening scope in both modes.

A numeric limit is an upper bound. A sparse pool may produce fewer records or an empty TXT. The same paper may belong to several groups, with one copy per output file.

## Relevance gate

Journal prestige cannot rescue an off-topic record. Score relevance against the semantic definition of the current group, not against a built-in subject.

- 0.90–1.00: every required semantic entity is explicit and central.
- 0.80–0.89: every required entity is present, with one implicit but well-supported.
- 0.70–0.79: adjacent or methodological context; exclude under the default 0.80 threshold.
- below 0.70: tangential or false positive.

Write `relevanceEvidence` that names the matched group concepts. Query membership alone is insufficient.

## Publication and identifier gates

- WOS: require DOI, `DT` containing Article, and `WE` containing `Science Citation Index Expanded (SCI-EXPANDED)` under the default policy.
- CNKI: require DOI and document type `期刊` under the default policy. Do not silently substitute theses, conferences, newspapers, patents, or network-only items.
- Normalize DOI by removing resolver prefixes, `doi:`, spaces, and terminal punctuation; compare case-insensitively.

These gates are configuration values. Change them only when the user asks for a different document scope.

## Time gate

For a run in year `Y`, recent means `Y-2` through `Y`. A 2026 run therefore uses 2024–2026.

Use WOS `PY`. For CNKI, prefer the formal year parsed from the GB/T citation over a network-first/list year.

An older paper may pass only when its metric is positive and belongs to the top configured fraction, default 10%, of the same database/group relevant candidate pool:

- WOS: cited count.
- CNKI: cited count or download count; either threshold is sufficient.

The exporter records every threshold. Collect a broad candidate pool because a small or biased pool weakens the exception.

## Journal evidence and ranking

After relevance, identifier, publication type, and time qualification, rank excess records deterministically by:

1. lower documented `journalTier`;
2. higher comparable official `journalScore`;
3. higher relevance score;
4. newer formal year;
5. higher citations, then downloads;
6. normalized DOI as a stable tie-breaker.

Acceptable evidence includes verified JCR quartile/year, documented field-specific WOS journal priority, and official CNKI navigation badges or metrics. SCI-EXPANDED proves index coverage, not a JCR quartile. When JCR is unavailable, identify a configured field-priority tier as local screening policy or leave the tier unavailable; never label it Q1–Q4. Report local CNKI badge-to-tier mappings as configurable policy, not universal truth.

Verify CNKI journal navigation evidence only for the topic/year/type/DOI shortlist. Store the observed badge or metric, source URL, and check date; do not infer quality from the search-result order.

Keep `journalEvidence` non-empty. Report inaccessible evidence rather than fabricating it.

## Audit trail

Preserve raw exports, normalized candidates, journal evidence, query-adjustment log, selected TXT files, summary, and JSON report. Each selected TXT block includes the evidence and metrics needed to review its rank.

