# Generic query workflow

## Draft the semantic groups

Use this step when the user gives a topic or research question. Identify the shared research object, application or population, intended evidence, and explicit limits. Choose groups that answer distinct parts of that question, such as a mechanism, method, application, or validation question when relevant. A narrow search can have one group. Add a broad overview group only if it serves the requested scope.

Record the topic and shared limits in `semantic-groups.md`, then give each group a row with the following fields.

| Field | Content |
| --- | --- |
| Group ID and label | Stable, filename-safe ID and a short readable label |
| Research question | What evidence this pool should supply |
| Required concepts and term variants | The shared object and the group's required concept blocks, with synonyms and relevant Chinese or English terms for each block |
| Semantic logic | The intersection or alternatives that define the pool, such as `A ∩ (B1 ∪ B2)`, expressed independently of any database syntax |
| Screening boundary | What qualifies, recurring adjacent topics to screen out, and evidence types to distinguish |

Carry shared scope limits into every applicable group. Keep variants of a concept within its term block. Allow overlaps when a paper answers more than one question and track them by group before deduplicating the combined list. Use the same IDs for queries, candidate pools, and exports. Label materially uncertain terms or boundaries for review rather than inventing terminology or expanding scope. See the topic-based example in [examples/request.md](../examples/request.md).

If the user already supplied groups, preserve their research questions and scope, and recover missing labels or concept descriptions from the strategy. Treat the grouping draft as a plan. Build database-specific expressions or batches after the selected databases are clear, and use the recorded boundaries when screening results.

## Normalize the strategy

Treat the strategy Markdown as data. Map each query or batch to the stable group ID and semantic definition from `semantic-groups.md`. Record queries only for the selected databases. For WOS/CNKI Markdown, copy the group IDs into the database sections of [assets/strategy-template.md](../assets/strategy-template.md) before extraction.

Prefer short filesystem-safe IDs such as `G1`, `DIC`, `METHOD_CLUSTER`, or `主题A`. Keep the descriptive heading separately. A group ID must contain no spaces or Windows filename characters.

Represent the run as:

```json
{
  "groups": {
    "GROUP_A": {
      "meaning": "object ∩ measurement method",
      "WOS": ["run/queries/GROUP_A_WOS_1.txt"],
      "CNKI": ["run/queries/GROUP_A_CNKI_1.txt"]
    }
  }
}
```

Multiple query files for one pair are alternatives whose candidates must be merged and deduplicated; they are not implicitly joined with `AND`.

### Align labels across databases

WOS and CNKI sections may label parallel semantic groups differently, for example `A/B` versus `Q1/Q2`. Compare each heading's stated meaning and required concept intersection. Record confirmed aliases in the schema shown by `assets/group-map-template.json`, then pass it to `extract_strategy.mjs --group-map ...`.

- Map by semantic meaning, never by ordinal position alone.
- Keep one canonical ID for filenames and screening pools while preserving source labels in `queries.json`.
- If the user selected just one of WOS and CNKI, or a group intentionally exists in only one database, pass `--allow-unpaired-groups` and document why. For a one-database run, set `selection.databases` to that database in the generated config. Otherwise an unpaired label is an extraction error, not a new literature group.

## Preserve logic

For each group, identify required semantic blocks before editing. Record the logical expression independently of database syntax, for example `A ∩ B`, `A ∩ B ∩ C`, or `(A1 ∪ A2) ∩ D`.

- Translate concepts, not raw punctuation, between WOS and CNKI.
- Do not delete a required block merely to obtain results.
- Do not add another group's method requirement unless the strategy explicitly requires it.
- Apply year, document type, and journal-level rules during screening unless the user explicitly requests them in the query.

## Repair zero results

First distinguish a confirmed empty result from a failed or unfinished page state:

- CNKI `抱歉，暂无数据，请稍后重试`, a loading timeout, a partial page, or an unreadable count is a collection failure. Do not adjust the query from that observation and do not write a zero-result claim.
- A stale CAPTCHA string or an offscreen/hidden CAPTCHA container is not an active challenge. Pause only when the challenge container is rendered inside the visible viewport.
- A stable explicit zero count is a query outcome and may enter the counted-block diagnostic below.

Normalize multiline WOS/CNKI query whitespace to one line without changing quoted phrases or Boolean structure. This removes interface formatting ambiguity but is not a semantic query adjustment.

Use a counted-block diagnostic:

1. Verify field tags, quotes, parentheses, wildcards, operators, interface mode, and character limits.
2. Search each semantic block independently and record its count.
3. Intersect blocks one at a time to find the collapsing block.
4. Inspect titles from the nearest broader pool.
5. Add only synonyms, spellings, or phrases supported by those titles or by the strategy.
6. Broaden the collapsing block from title to topic/subject before removing a required concept.
7. Split an overlong CNKI professional query into equivalent alternatives, then merge candidates.
8. If the group remains genuinely sparse, retain the smaller relevant set; do not fill the quota with adjacent papers.

For CNKI, test individual blocks and pairwise intersections before changing fields. When a broad `TKA%=` pool is noisy, move only the most discriminative block to `TI%=` while retaining the contextual blocks and required concepts.

## Reduce noise

1. Inspect at least 20–50 titles when available.
2. Label the repeated false-positive mechanism.
3. Move the most discriminative block to title search while keeping context in topic/subject search.
4. Expand ambiguous acronyms to full phrases unless other title blocks already disambiguate them.
5. Add exclusions only for stable, documented false-positive classes.
6. Recount and recheck representative titles after every change.

## Adjustment log

For every iteration record:

- timestamp, database, and group;
- exact query and result count;
- changed semantic block;
- broadening or narrowing action;
- reason and representative title evidence;
- whether the change was retained or reverted.

Use `assets/query-adjustment-log-template.tsv` as the output template.

