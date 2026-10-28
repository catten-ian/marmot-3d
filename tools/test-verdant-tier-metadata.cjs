'use strict';
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const { tierDisplayRows } = await import('../src/world/verdant-tier-metadata.mjs');
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets/verdant/manifest.json'), 'utf8'));
  const rows = tierDisplayRows(catalog);
  if (rows.length !== 4) throw new Error(`expected 4 tier rows, got ${rows.length}`);
  for (const row of rows) {
    const entry = catalog.tiers[row.id];
    if (!row.faces.startsWith(Number(entry.faces).toLocaleString())) throw new Error(`face drift ${row.id}`);
    if (!row.size || row.size === '—') throw new Error(`size missing ${row.id}`);
  }
  console.log('verdant tier metadata consistency passed');
})().catch((error) => { console.error(error); process.exit(1); });
