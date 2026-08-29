import { isValidGroupId } from './screening.mjs';

function normalizedId(value, label) {
  const id = String(value ?? '').trim().toUpperCase();
  if (!isValidGroupId(id)) throw new Error(`Invalid ${label} group ID: ${value}`);
  return id;
}

export function parseGroupMap(payload) {
  const source = payload?.canonicalGroups;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Group map must contain a canonicalGroups object. See assets/group-map-template.json.');
  }
  const aliases = new Map();
  const meanings = new Map();
  for (const [canonicalValue, definition] of Object.entries(source)) {
    const canonical = normalizedId(canonicalValue, 'canonical');
    meanings.set(canonical, String(definition?.meaning ?? '').trim());
    for (const database of ['WOS', 'CNKI']) {
      const databaseAliases = definition?.aliases?.[database] ?? [];
      if (!Array.isArray(databaseAliases)) throw new Error(`${canonical}.aliases.${database} must be an array.`);
      for (const aliasValue of [canonical, ...databaseAliases]) {
        const alias = normalizedId(aliasValue, `${database} alias`);
        const key = `${database}\u0000${alias}`;
        const existing = aliases.get(key);
        if (existing && existing !== canonical) {
          throw new Error(`Group alias collision for ${database} ${alias}: ${existing} and ${canonical}`);
        }
        aliases.set(key, canonical);
      }
    }
  }
  return { aliases, meanings };
}

export function canonicalGroup(rawGroup, database, groupMap) {
  const raw = normalizedId(rawGroup, 'source');
  if (!groupMap) return raw;
  return groupMap.aliases.get(`${String(database).toUpperCase()}\u0000${raw}`) ?? raw;
}

export function findUnpairedGroups(blocks) {
  const databasesByGroup = new Map();
  for (const block of blocks) {
    if (!databasesByGroup.has(block.group)) databasesByGroup.set(block.group, new Set());
    databasesByGroup.get(block.group).add(block.database);
  }
  return [...databasesByGroup]
    .filter(([, databases]) => !databases.has('WOS') || !databases.has('CNKI'))
    .map(([group, databases]) => ({ group, databases: [...databases].sort() }))
    .sort((left, right) => left.group.localeCompare(right.group));
}

