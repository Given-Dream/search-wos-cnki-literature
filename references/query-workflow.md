# Generic query workflow

## Normalize the strategy

Treat the user's Markdown as a data source. Extract a stable group ID, semantic definition, WOS query, and CNKI query for every group. The strategy may add or remove groups; never assume Q1–Q4.

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

## Preserve logic

For each group, identify required semantic blocks before editing. Record the logical expression independently of database syntax, for example `A ∩ B`, `A ∩ B ∩ C`, or `(A1 ∪ A2) ∩ D`.

- Translate concepts, not raw punctuation, between WOS and CNKI.
- Do not delete a required block merely to obtain results.
- Do not add another group's method requirement unless the strategy explicitly requires it.
- Apply year, document type, and journal-level rules during screening unless the user explicitly requests them in the query.

## Repair zero results

Use a counted-block diagnostic:

1. Verify field tags, quotes, parentheses, wildcards, operators, interface mode, and character limits.
2. Search each semantic block independently and record its count.
3. Intersect blocks one at a time to find the collapsing block.
4. Inspect titles from the nearest broader pool.
5. Add only synonyms, spellings, or phrases supported by those titles or by the strategy.
6. Broaden the collapsing block from title to topic/subject before removing a required concept.
7. Split an overlong CNKI professional query into equivalent alternatives, then merge candidates.
8. If the group remains genuinely sparse, retain the smaller relevant set; do not fill the quota with adjacent papers.

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

