# Candidate and TXT data contract

## Candidate JSON

`scripts/select_and_export.mjs` accepts JSON arrays or objects with a `records` array:

```json
{
  "group": "GROUP_A",
  "database": "WOS",
  "title": "Paper title",
  "year": 2025,
  "formalYear": 2025,
  "authors": ["Author One", "Author Two"],
  "doi": "10.1234/example",
  "sourceTitle": "Journal Name",
  "documentType": "Article",
  "webOfScienceIndex": "Science Citation Index Expanded (SCI-EXPANDED)",
  "abstract": "...",
  "citedCount": 12,
  "downloadCount": 0,
  "relevanceScore": 0.95,
  "relevanceEvidence": "The title and abstract satisfy every GROUP_A concept.",
  "journalTier": 1,
  "journalScore": 8.2,
  "journalEvidence": "Verified source and observation",
  "jcrQuartile": "Q1",
  "journalBadges": []
}
```

Rules:

- `group` is any strategy-defined ID containing letters, digits, `_`, `-`, or `.` and no spaces.
- `database` is WOS or CNKI.
- `authors` may be an array or semicolon-separated text.
- `formalYear` overrides `year`; the CNKI collector derives it from GB/T citation when possible.
- Relevance and journal fields are screening annotations, not facts inferred from result order.
- CNKI `journalBadges` may drive the configurable tier mapping when `journalTier` is absent.
- Extra raw-source fields and URLs are allowed.

## Dynamic groups

With `selection.groups: "auto"`, the exporter derives groups from candidate records. For an empty-result group that must still produce files, set an explicit array in the run config:

```json
"groups": ["GROUP_A", "GROUP_B", "GROUP_C"]
```

## Selector input and output

```powershell
node scripts/select_and_export.mjs --config run/config.json --output run/final --input run/candidates/GROUP_A_WOS.annotated.json --input run/candidates/GROUP_A_CNKI.annotated.json
```

The exporter writes `<group>_WOS.txt`, `<group>_CNKI.txt`, `筛选说明与数量核验.txt`, and `selection-report.json`.

## TXT record format

Each block begins with `[n]`, includes Title, Year, Authors, and DOI, and ends with `---`. Files are UTF-8 with BOM. Exclude missing-DOI records instead of writing `N/A`.

