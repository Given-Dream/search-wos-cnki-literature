# Scripted Edge workflow

## Safety boundary

Use Playwright over Edge's Chrome DevTools Protocol (CDP). Do not use computer-use. Do not read browser cookies, storage, passwords, tokens, or profile files. Do not automate CAPTCHA or evade institutional access controls; ask the user to complete those steps in the visible Edge window.

## Runtime

The scripts try `PLAYWRIGHT_MODULE_URL`, the normal `playwright` package, and then the bundled Windows Codex runtime path. Set `PLAYWRIGHT_MODULE_URL` when Playwright lives elsewhere.

Create a confirmed database selection plan before starting a persistent session. Never navigate to WOS, CNKI, or another database before the user answers the required first-turn question.

## Mandatory normal Edge desktop window

All interactive retrieval, including WOS, CNKI, and CQVIP, must use a normal Microsoft Edge desktop window that is opened and kept running. This is a hard requirement. Headless or hidden Edge, in-app browser frames, screenshot streaming, and localhost input/verification relay panels are not alternatives. Do not instruct the user to open a local-port URL to handle consent, login, or a slider.

On Windows, `edge_session.mjs` now calls `start_edge_cdp.mjs`, which starts Edge using `Start-Process -WindowStyle Normal` with a dedicated persistent profile, `--new-window`, and `--start-maximized`. It then obtains the browser PID from CDP and verifies that process's native `MainWindowHandle`, `IsWindowVisible`, and match to the interactive input desktop. CDP readiness alone is insufficient. A headless endpoint is rejected. `native-window-unconfirmed` is a launch failure, so no batch collection may proceed and no “window is open” claim may be made.

Start the ordinary Edge window from the confirmed plan:

```powershell
node scripts/edge_session.mjs --profile-dir D:\codex\.edge-wos-cnki-profile --port 9333 --plan D:\codex\literature-run\database-selection.json
```

Without `--plan` or an explicit `--start-url`, the session opens `about:blank`; it must not assume WOS. A loopback CDP port remains an internal automation connection, never a user-facing verification page or relay. Do not describe an internal connection as the user's browser surface.

Before asking for a manual step, confirm native-window evidence and tell the user to act directly in the ordinary Edge window. Report “普通 Edge 窗口已打开并保持运行” only after that evidence exists. If the user reports no visible window, repair the normal Windows launch, including execution in the user's interactive desktop when a restricted worker cannot create a visible window. Do not repeatedly ask for verification in an invisible session or fall back to a relay. Keep certificate validation enabled; do not solve TLS failures by ignoring certificates.

Once the window is confirmed and the user clears any gate, reuse the same persistent session. Background collection means background tabs and DOM/network access inside that native session; it does not mean a hidden browser process. Do not steal focus, repeatedly maximize or resize the native window, inject desktop mouse or keyboard events, or poll screenshots. The user may minimize or switch away from the window while working; do not restore it automatically. If another real challenge appears, pause and hand it to the user in that ordinary window.

When finished, stop query workers and polling and disconnect the script (`Ctrl+C` for `edge_session.mjs`). The external Edge window survives this disconnection. Keep it open if requested; otherwise close only the dedicated task window. Never close the user's everyday Edge windows or modify the everyday profile or system proxy.

## CQVIP external Edge/CDP mode

CQVIP can return HTTP 403 or 412 to a fresh Playwright context even when the same machine can open the site in a normal browser. Treat that result as `automation-restricted`, not as proof that CQVIP is unavailable. Do not spoof browser fingerprints, export cookies, or add stealth plugins.

After the user has selected database 17, create its confirmed plan with a CQVIP-specific Boolean expression, then start a normal visible Edge process with a dedicated profile and a loopback-only CDP endpoint:

```powershell
node scripts/select_databases.mjs --selection 17 --boolean-query '("岩石力学" OR 地质力学) AND 断裂' --output run\database-selection.json
node scripts/start_edge_cdp.mjs --profile-dir G:\codex\.edge-cqvip-profile --port 9333 --start-url https://qikan.cqvip.com/
```

The first run may require the user to wait for client-side checks, log in, confirm institutional access, or solve a CAPTCHA in the visible window. Keep that Edge window open. Then attach the plan without launching a second browser:

```powershell
node scripts/edge_session.mjs --connect-over-cdp http://127.0.0.1:9333 --plan run\database-selection.json
```

Check readiness or submit one visible Boolean expression. CQVIP's documented main search box accepts Boolean logic; the script rejects generic `--query` and non-Boolean text:

```powershell
node scripts/cqvip_search.mjs --debugger-url http://127.0.0.1:9333
node scripts/cqvip_search.mjs --debugger-url http://127.0.0.1:9333 --boolean-query '("岩石力学" OR 地质力学) AND 断裂'
```

`ready` means the visible CQVIP search input is present. `manual-action-required` means the user must complete a visible login or verification step. `automation-restricted` means the attached session still shows a 403/412-style gate; stop and report it rather than retrying aggressively. The script does not read cookies, tokens, passwords, or browser storage. It submits the search form only; it does not claim normalized candidate extraction or full-text entitlement.

The dedicated profile is reusable, but do not point this workflow at the user's everyday Edge profile. Bind CDP only to `127.0.0.1`; preserve a window the user asked to keep open and do not expose the debugging port to the network.

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

- Verify the native Edge window, not just CDP, before saying it is open or starting collection.
- Confirm active URL and title before submission.
- Save exact query and displayed count.
- Save the collection state sidecar and distinguish `confirmed-empty`, `transient-error`, and `partial`.
- Confirm downloaded files exist and parse successfully.
- Treat zero DOI, empty authors, or implausible counts as collection failures until explained.

