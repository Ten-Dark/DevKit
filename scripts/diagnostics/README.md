# Local diagnostics

These scripts are manual ZIP inspection helpers for XMind fixture investigation. They are not part of the production conversion path or CI pipeline.

Run them from any working directory with the repository's supported Node.js version:

- `node scripts/diagnostics/debug-eocd.cjs` — inspect ZIP EOCD/central-directory records in the checked-in fixture set.
- `node scripts/diagnostics/debug-extract.cjs` — inspect local ZIP headers and sample compressed entry payloads.

Both scripts resolve `scripts/__xmind_fixtures__` relative to their own location. Keep fixture files in that directory.\n