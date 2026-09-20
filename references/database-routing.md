# Database selection and routing

## Required confirmation gate

When the Skill is invoked, first display the exact question `是否使用默认的 WOS + 知网完整采集？` together with the grouped, numbered catalog from `node scripts/select_databases.mjs --list`. The Boolean-capable group is numbered first; the keyword-batch group follows it. Stop and wait for the user's answer. Do not parse a strategy, start Edge, navigate to a database, or collect records before that answer.

- If the user explicitly agrees, create a default plan with `--default`. Only then run the complete WOS and CNKI collectors.
- Otherwise, require one or more catalog numbers. Accept comma-separated numbers and ascending ranges. Create a custom plan with `--selection`; do not silently add WOS or CNKI.
- If the reply is ambiguous, ask for either an explicit confirmation or database numbers. Do not infer consent from the fact that WOS and CNKI are defaults.

## Commands

Display the required first-turn prompt and numbered catalog:

```powershell
node scripts/select_databases.mjs --list
```

After explicit agreement to the default:

```powershell
node scripts/select_databases.mjs --default --output run\database-selection.json
```

After a non-default numbered choice:

```powershell
node scripts/select_databases.mjs --selection 3,5-7 --output run\database-selection.json
```

When exactly one Boolean-capable database is selected, attach only that database's own Boolean expression:

```powershell
node scripts/select_databases.mjs --selection 3 --boolean-query '("rock mechanics" OR geomechanics) AND fracture' --output run\database-selection.json
```

When exactly one keyword-batch database is selected, attach one plain batch:

```powershell
node scripts/select_databases.mjs --selection 21 --keyword-query "rock mechanics" --output run\database-selection.json
```

Generic `--query` is disabled. A query-bearing plan may contain exactly one database because syntax and field behavior are database-specific. For a multi-database selection, create the plan without a query, then create and log one query or batch set per database.

## Two query logics

### Boolean-capable group

Every selected database in this group must use Boolean construction:

1. Form one `OR` block for synonyms and spelling variants of each concept.
2. Join required concept blocks with `AND`.
3. Add `NOT` only when a documented false-positive class justifies it.
4. Translate the abstract logic into the selected database's `queryDialect`: field tags, phrase marks, wildcards, proximity syntax, operator capitalization, and form rows are not portable across databases.
5. Save the exact submitted expression and visible result count.

If `booleanSubmission` is `query-url`, the plan may encode the expression into the documented URL. If it is `collector`, pass the database-specific expression to that collector. If it is `advanced-form`, reproduce the logic with the site's visible rows and operators; `queryPending: true` means it has not yet been submitted. CQVIP uses `visible-search-box`: its documented main search box accepts Boolean expressions, and `scripts/cqvip_search.mjs` therefore accepts only `--boolean-query`.

### Keyword-batch group

Do not paste a Boolean string into these sites. Split the strategy into auditable keyword or visible-field batches, run every batch separately, then union and deduplicate by DOI, database identifier, normalized title, year, and first author as available. Record each batch and result count. An uppercase `AND`, `OR`, or `NOT` in `--keyword-query` is rejected so a Boolean expression cannot be silently treated as literal text.

For a mixed database selection, maintain separate Boolean and keyword-batch ledgers. Never infer that one successful expression is valid for another database.

## Retrieval modes

- `scripted-collector`: WOS and CNKI have repository collectors. Run them only when their numbers are present in the confirmed plan.
- `query-url`: the plan can place a capability-matched query in a documented search URL and open it in the visible Edge session. Treat the resulting page as a search starting point, not as a normalized candidate export.
- `browser-assisted`: open the documented search page and let the user complete field/operator rows, login, institutional authentication, consent, or CAPTCHA. Do not improvise coordinate clicks or claim automated collection.

CQVIP is database 17 and a specialized `browser-assisted` entry. Start a dedicated normal Edge profile with `scripts/start_edge_cdp.mjs`, attach only over a loopback CDP URL, and run `scripts/cqvip_search.mjs --boolean-query <CQVIP-expression>` after the visible search field reaches `ready`. A fresh-profile 403/412 is `automation-restricted`; it is not a site-outage conclusion. Do not use stealth flags, transfer cookies, or automate a challenge.

The Chinese Academy of Sciences dissertation endpoint is database 22 and currently HTTP-only. Its catalog entry carries `allowInsecureHttp: true`; do not generalize this exception to another database. It is routed as keyword/visible-field batches because explicit Boolean operator syntax has not been verified.

Do not apply the WOS/CNKI screening and TXT export contract to a publisher platform unless records have actually been normalized to `references/data-contract.md`. Report which selected databases produced automated candidates and which remained browser-assisted.

## Reachability testing

Run a landing-page smoke test without credentials:

```powershell
node scripts/test_database_access.mjs --all --output run\database-access.json
```

Interpret the report conservatively:

- `landing-reachable` means the public entry page loaded.
- `authentication-required` or `verification-required` means navigation reached a gate that needs the user.
- `automation-restricted` means the public host responded but rejected the fresh automated context; verify in a user-controlled visible CDP session before drawing an availability conclusion.
- `http-*`, `access-denied`, `timeout`, and `navigation-failed` require investigation or a later retry.
- `institutionalFullTextVerified` remains `false` in every landing-page smoke test. Opening a site, seeing a login page, or reaching search results does not prove subscription or full-text entitlement.

Never read cookies, tokens, passwords, or browser storage; never bypass access controls or CAPTCHA.
