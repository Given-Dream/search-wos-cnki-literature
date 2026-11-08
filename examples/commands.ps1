# Before running this example, save semantic-groups.md, confirm WOS + CNKI and the retention choice,
# then draft the database-specific Markdown strategy.
node scripts/select_databases.mjs --default --output D:\codex\literature-run\database-selection.json
node scripts/extract_strategy.mjs --strategy D:\path\search-strategy.md --output D:\codex\literature-run --config-template config/default.json

# If WOS and CNKI use different source labels for parallel semantic groups:
# node scripts/extract_strategy.mjs --strategy D:\path\search-strategy.md --group-map D:\path\group-map.json --output D:\codex\literature-run --config-template config/default.json

# Set selection.maxPerDatabaseGroup in config.json to the confirmed number or "all".
# Terminal 1: after checking the group/query mapping and run config, start the visible Edge session.
node scripts/edge_session.mjs --profile-dir D:\codex\.edge-wos-cnki-profile --port 9333 --plan D:\codex\literature-run\database-selection.json

# Terminal 2: repeat these commands for each group/query listed in literature-run\queries.json.
node scripts/wos_collect.mjs --query-file D:\codex\literature-run\queries\GROUP_A_WOS_1.txt --output D:\codex\literature-run\raw\GROUP_A_WOS.txt --meta-output D:\codex\literature-run\raw\GROUP_A_WOS.meta.json --limit 200 --label GROUP_A
node scripts/parse_wos_export.mjs D:\codex\literature-run\raw\GROUP_A_WOS.txt --group GROUP_A --output D:\codex\literature-run\candidates\GROUP_A_WOS.json
node scripts/cnki_collect.mjs --query-file D:\codex\literature-run\queries\GROUP_A_CNKI_1.txt --output D:\codex\literature-run\candidates\GROUP_A_CNKI.json --state-output D:\codex\literature-run\raw\GROUP_A_CNKI.state.json --limit 300 --label GROUP_A
node scripts/cnki_verify_journals.mjs --input D:\codex\literature-run\candidates\GROUP_A_CNKI.shortlist.json --output D:\codex\literature-run\evidence\cnki-journals.json

# Annotate relevance and journal evidence, then select and validate.
node scripts/select_and_export.mjs --config D:\codex\literature-run\config.json --output D:\codex\literature-run\final --input D:\codex\literature-run\candidates\GROUP_A_WOS.annotated.json --input D:\codex\literature-run\candidates\GROUP_A_CNKI.annotated.json
node scripts/validate_outputs.mjs --config D:\codex\literature-run\config.json --input D:\codex\literature-run\final

# When finished, press Ctrl+C in Terminal 1 to close the scripted Edge session.

