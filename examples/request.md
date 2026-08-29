# Generic example request

Use `$search-wos-cnki-literature` to execute the supplied Markdown strategy in WOS and CNKI through scripted Microsoft Edge. Semantically align different WOS/CNKI source labels with an explicit group map, distinguish transient/verification states from confirmed zero results, repair confirmed zero-result queries with block counts and title evidence, and independently select no more than 10 highly relevant records per database/group. Prefer the latest three years, allow documented high-impact older exceptions, rank excess records by verified journal evidence, and export UTF-8 BOM TXT files containing Title, Year, Authors, and DOI.

Expected deliverables are one WOS and one CNKI TXT for every strategy group, collection-state sidecars, a screening summary, `selection-report.json`, and a query-adjustment log.

