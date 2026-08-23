export function parseArgs(argv, repeatable = new Set()) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next !== undefined && !next.startsWith('--') ? next : true;
    if (value !== true) index += 1;
    if (repeatable.has(key)) {
      args[key] ??= [];
      args[key].push(value);
    } else {
      args[key] = value;
    }
  }
  return args;
}

export function requireArgs(args, names, usage) {
  const missing = names.filter((name) => args[name] === undefined);
  if (missing.length) {
    throw new Error(`Missing ${missing.map((name) => `--${name}`).join(', ')}.\n${usage}`);
  }
}

