# Scripted Edge workflow

## Safety boundary

Use Playwright over Edge's Chrome DevTools Protocol (CDP). Do not use computer-use. Do not read browser cookies, storage, passwords, tokens, or profile files. Do not automate CAPTCHA or evade institutional access controls; ask the user to complete those steps in the visible Edge window.

## Runtime

The scripts try `PLAYWRIGHT_MODULE_URL`, the normal `playwright` package, and then the bundled Windows Codex runtime path. Set `PLAYWRIGHT_MODULE_URL` when Playwright lives elsewhere.

Start a persistent session:

```powershell
node scripts/edge_session.mjs --profile-dir D:\codex\.edge-wos-cnki-profile --port 9333
```

Keep it alive only while the run is active. Collectors connect to `http://127.0.0.1:9333`. When collection and validation finish, return to the session terminal and press `Ctrl+C`; confirm the process exits so the profile does not retain background page activity.

## Strategy extraction

For compatible Markdown, create a run layout first:

```powershell
node scripts/extract_strategy.mjs --strategy D:\path\strategy.md --output D:\codex\literature-run --group-map D:\path\group-map.json --config-template config/default.json
```

This emits one-line query files, `queries.json`, and a run-specific `config.json`. Omit `--group-map` when source labels already match. Inspect the canonical groups, source-label mapping, and query files before searching; the parser extracts structure but does not decide scientific meaning.

## WOS routing and collection

Mainland-China institutional sessions may resolve WOS to `webofscience.clarivate.cn`. A proxy rule that only directs `webofscience.com` can therefore be incomplete:

```text
DOMAIN-SUFFIX,webofscience.com,DIRECT
DOMAIN-SUFFIX,clarivate.cn,DIRECT
```

Follow institutional network policy. For one generic group:

```powershell
node scripts/wos_collect.mjs --query-file run/queries/GROUP_A_WOS_1.txt --output run/raw/GROUP_A_WOS.txt --meta-output run/raw/GROUP_A_WOS.meta.json --limit 200 --label GROUP_A
node scripts/parse_wos_export.mjs run/raw/GROUP_A_WOS.txt --group GROUP_A --output run/candidates/GROUP_A_WOS.json
```

The export is a candidate pool, not a final result. If selectors change, inspect visible DOM state and update the script; do not fall back to coordinate clicking.

The collector supports both the current `data-ta="run-search"` control and the legacy accessible Search button, plus current and legacy field-tagged export dialogs. An unreadable count is a UI-state failure and must not be reported as zero.

## CNKI collection

CNKI GB/T citation output supplies DOI and formal year; EndNote is not required.

```powershell
node scripts/cnki_collect.mjs --query-file run/queries/GROUP_A_CNKI_1.txt --output run/candidates/GROUP_A_CNKI.json --state-output run/raw/GROUP_A_CNKI.state.json --limit 300 --label GROUP_A
node scripts/cnki_verify_journals.mjs --input run/candidates/GROUP_A_CNKI.shortlist.json --output run/evidence/cnki-journals.json
```

The collector polls rendered page state rather than sleeping for a fixed five seconds. It requires an explicit zero count to remain stable before writing `confirmed-empty`; `暂无数据，请稍后重试` times out as `transient-error` and does not overwrite the candidate file. If 50-row mode fails, it continues through normal pagination and reports warnings. A `partial` output is not a complete pool.

If a slider is actually visible in the viewport, let the user solve it in Edge and rerun against the same profile. Do not infer a slider from stale body text or an offscreen `#tCaptchaDyMainWrap`, and never automate or bypass the challenge.

Create the journal-verification input after DOI/document-type/year/relevance pre-screening. This limits CNKI navigation requests to journals that can still enter the final selection.

## Checks

- Confirm active URL and title before submission.
- Save exact query and displayed count.
- Save the collection state sidecar and distinguish `confirmed-empty`, `transient-error`, and `partial`.
- Confirm downloaded files exist and parse successfully.
- Treat zero DOI, empty authors, or implausible counts as collection failures until explained.

