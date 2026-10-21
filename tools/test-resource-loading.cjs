const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// The UI installer is exercised in a tiny DOM shim so this stays dependency-free.
const source = fs.readFileSync(path.join(__dirname, '..', 'src/world/local-pack.js'), 'utf8')
  .replace("import { REQUIRED_LOCAL_ASSETS, normalizePath, resolveLocalEntries } from './local-pack-resolver.mjs';", "const REQUIRED_LOCAL_ASSETS=['assets/verdant/manifest.json','assets/verdant/verdant-trail-height.json','assets/verdant/verdant-trail.glb','assets/models/marmot.glb','assets/models/fox-segmented.glb']; const normalizePath=(p)=>String(p||'').replaceAll('\\\\','/'); const resolveLocalEntries=()=>({state:'ready',found:REQUIRED_LOCAL_ASSETS,missing:[],message:'ready',files:new Map(),candidates:['pack']});")
  .replace(/^export /gm, '')
  .replace(/const canFS = .*?;\n/, "const canFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window;\n");
const listeners = new Map();
function el(id) { return { id, dataset: {}, files: [], hidden: false, addEventListener(type, fn) { listeners.set(id+':'+type, fn); }, click() { this.clicked = (this.clicked || 0) + 1; } }; }
const els = {};
global.window = { showDirectoryPicker: async () => { window.picked = (window.picked || 0) + 1; return { values: async function* () {} }; } };
global.document = { getElementById: (id) => els[id] || null, querySelectorAll: (sel) => { const ids = sel.includes('localPackChoose') ? ['localPackChoose'] : sel.includes('localPackInput') ? ['localPackInput'] : sel.includes('localPackReauth') ? [] : sel.includes('localPackStatus') ? ['localPackStatus'] : []; return ids.map((id) => els[id]).filter(Boolean); } };
global.URL = { createObjectURL: () => 'blob:test' };
vm = require('node:vm');
const ctx = vm.createContext({ window, document, URL, console, setTimeout, clearTimeout, Map, Set, Promise, indexedDB: undefined });
vm.runInContext(`${source}\nthis.api={installLocalPackUI,getLocalPackStatus};`, ctx);
els.localPackChoose = el('localPackChoose'); els.localPackInput = el('localPackInput'); els.localPackStatus = el('localPackStatus');
ctx.api.installLocalPackUI();
ctx.api.installLocalPackUI();
listeners.get('localPackChoose:click')();
returnPromise = Promise.resolve().then(async () => {
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(window.picked, 1, 'late title button binds once after repeated install');
  assert.equal(els.localPackChoose.clicked || 0, 0);
  // fallback input path is selected when File System Access is absent.
  const fallbackSource = source.replace("const canFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window;", "const canFS = false;");
  const fallbackCtx = vm.createContext({ window: {}, document, URL, console, setTimeout, clearTimeout, Map, Set, Promise, indexedDB: undefined });
  vm.runInContext(`${fallbackSource}\nthis.api={installLocalPackUI};`, fallbackCtx);
  els.localPackChoose.dataset = {}; els.localPackInput.dataset = {};
  fallbackCtx.api.installLocalPackUI();
  listeners.get('localPackChoose:click')();
  assert.equal(els.localPackInput.clicked, 1, 'fallback uses hidden directory input');
  // AbortError is intentionally ignored.
  assert.match(ctx.api.getLocalPackStatus().state, /none|ready/);
  const glb = fs.readFileSync(path.join(__dirname, '..', 'assets/models/fox-segmented.glb'));
  let off = 12; let json = null;
  while (off < glb.length) { const len = glb.readUInt32LE(off); const type = glb.readUInt32LE(off + 4); if (type === 0x4e4f534a) json = JSON.parse(glb.subarray(off + 8, off + 8 + len).toString()); off += 8 + len; }
  assert.deepEqual(json.images || [], [], 'segmented fox has no embedded images');
  assert.deepEqual(json.textures || [], [], 'segmented fox has no texture objects');
  assert.equal(json.meshes.flatMap((m) => m.primitives).some((p) => p.attributes.COLOR_0 !== undefined), false, 'segmented fox does not carry vertex colors');
  const loader = fs.readFileSync(path.join(__dirname, '..', 'src/models/loader.js'), 'utf8');
  assert.match(loader, /getAssetResolutionStatus/);
  assert.match(loader, /source: info\?\.source \|\| 'server'/);
  const settings = fs.readFileSync(path.join(__dirname, '..', 'src/ui/settings.js'), 'utf8');
  assert.match(settings, /if \(IS_DEV\) html \+= this\._resourceMarkup\(\)/);
  assert.match(settings, /aria-label="资源加载"/);
  assert.match(settings, /release\/verdant-models\.zip/);
  assert.match(settings, /data-resource-retry/);
  console.log(JSON.stringify({ ok: true, installer: 'late-bind + idempotent + fallback', abort: 'silent', settings: 'DEV-only resource manager markup' }, null, 2));
});
returnPromise.catch((e) => { console.error(e); process.exitCode = 1; });
