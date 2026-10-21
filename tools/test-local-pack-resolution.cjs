const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'src/world/local-pack-resolver.mjs'), 'utf8')
  .replace(/^export const /gm, 'const ').replace(/^export function /gm, 'function ');
const ctx = {}; vm.runInNewContext(`${src}\nthis.api={resolveLocalEntries,normalizePath,REQUIRED_LOCAL_ASSETS};`, ctx);
const { resolveLocalEntries, REQUIRED_LOCAL_ASSETS } = ctx.api;
const files = (prefix) => new Map(REQUIRED_LOCAL_ASSETS.map((p) => [`${prefix}${p}`, { id: p }]));
const windows = resolveLocalEntries(files('outer\\verdant_trail\\'));
if (windows.state !== 'ready') throw new Error('separator normalization failed');
for (const prefix of ['', 'verdant_trail/', 'outer/verdant_trail/']) {
  const r = resolveLocalEntries(files(prefix));
  if (r.state !== 'ready' || r.found.length !== 5) throw new Error(`root selection failed: ${prefix} ${r.message}`);
}
const missing = files('verdant_trail/'); missing.delete('verdant_trail/assets/models/marmot.glb');
const partial = resolveLocalEntries(missing);
if (partial.state !== 'partial' || !partial.missing.includes('assets/models/marmot.glb')) throw new Error('missing status failed');
const dup = new Map([...files('one/'), ...files('two/')]);
const ambiguous = resolveLocalEntries(dup);
if (ambiguous.state !== 'ambiguous' || !/多个|候选/.test(ambiguous.message)) throw new Error(`ambiguity status failed: ${ambiguous.message}`);
console.log(JSON.stringify({ ok: true, root: resolveLocalEntries(files('')).found, parent: resolveLocalEntries(files('verdant_trail/')).found, ambiguous: ambiguous.message }, null, 2));
