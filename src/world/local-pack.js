/** Dev-only local resource-pack directory picker and resolver. */
const DB_NAME = 'marmot3d-local-pack';
const STORE = 'handles';
const KEY = 'verdant-dev-pack';
const REQUIRED = [
  'assets/verdant/manifest.json',
  'assets/verdant/verdant-trail-height.json',
  'assets/verdant/verdant-trail.glb',
  'assets/models/marmot.glb',
  'assets/models/fox-segmented.glb',
];

const canFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
let active = null;
let status = { state: 'none', found: [], missing: REQUIRED.slice(), message: '未选择本地资源包' };

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function saveHandle(handle) {
  try { const db = await openDb(); if (!db) return;
    await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(handle, KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  } catch (_) { /* persistence is optional */ }
}
async function readHandle() {
  try { const db = await openDb(); if (!db) return null;
    return await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).get(KEY); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); });
  } catch (_) { return null; }
}
async function walk(dir, prefix = '') {
  const out = new Map();
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') out.set(path, entry);
    else for (const [k, v] of await walk(entry, path)) out.set(k, v);
  }
  return out;
}
function normalizeInputPath(path) {
  const p = path.replaceAll('\\', '/').replace(/^\.?\//, '');
  const at = p.indexOf('assets/');
  return at >= 0 ? p.slice(at) : p;
}
async function validate(root, entries) {
  const files = entries || await walk(root);
  const found = REQUIRED.filter((p) => files.has(p) || files.has(root.name ? `${root.name}/${p}` : p));
  const missing = REQUIRED.filter((p) => !found.includes(p));
  status = { state: missing.length ? 'partial' : 'ready', found, missing, message: missing.length ? `资源包不完整：缺少 ${missing.length} 个文件` : '本地资源包已就绪' };
  const urls = new Map();
  for (const path of found) { const entry = files.get(path) || files.get(`${root.name}/${path}`); if (entry) urls.set(path, URL.createObjectURL(await entry.getFile())); }
  active = { root, files, urls };
  return status;
}
async function selectDirectory() {
  if (!canFS) throw new Error('当前浏览器不支持目录选择，请使用文件夹选择框');
  const root = await window.showDirectoryPicker({ mode: 'read' });
  const result = await validate(root);
  if (result.state === 'ready') await saveHandle(root);
  return result;
}
async function selectFiles(fileList) {
  const entries = new Map();
  for (const file of fileList) entries.set(normalizeInputPath(file.webkitRelativePath || file.name), { getFile: async () => file });
  return validate({ name: (fileList[0]?.webkitRelativePath || '').split('/')[0] || 'selected-pack' }, entries);
}
export async function restoreLocalPack() {
  if (!canFS) return status;
  const handle = await readHandle();
  if (!handle) return status;
  try {
    const permission = await handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') { status = { ...status, state: 'needs-permission', message: '已记住资源包，请重新授权读取目录' }; return status; }
    return validate(handle);
  } catch (_) { return status; }
}
export async function requestStoredPackPermission() {
  const handle = await readHandle();
  if (!handle?.requestPermission) return status;
  const permission = await handle.requestPermission({ mode: 'read' });
  if (permission === 'granted') return validate(handle);
  status = { ...status, state: 'needs-permission', message: '未获得目录读取权限' }; return status;
}
export function getLocalPackStatus() { return { ...status, required: REQUIRED.slice() }; }
export function resolveLocalAsset(path) {
  if (!active) return null;
  return active.urls.get(normalizeInputPath(path)) || null;
}
let uiInstalled = false;
export function installLocalPackUI({ onChange } = {}) {
  if (uiInstalled || (!canFS && !document.getElementById('localPackInput'))) return;
  const button = document.getElementById('localPackChoose');
  const input = document.getElementById('localPackInput');
  if (!button && !input) return;
  uiInstalled = true;
  const reauth = document.getElementById('localPackReauth');
  const render = () => {
    const box = document.getElementById('localPackStatus'); if (!box) return;
    const s = getLocalPackStatus();
    box.innerHTML = `<b>${s.message}</b><br><small>已找到 ${s.found.length}/${s.required.length} 个文件${s.missing.length ? `<br>缺少：${s.missing.join('、')}` : ''}</small>`;
    if (reauth) reauth.hidden = s.state !== 'needs-permission';
  };
  button?.addEventListener('click', async () => { if (!canFS) { input?.click(); return; } try { await selectDirectory(); render(); onChange?.(status); } catch (e) { if (e?.name !== 'AbortError') { status = { ...status, state: 'error', message: e.message }; render(); } } });
  input?.addEventListener('change', async () => { if (input.files?.length) { await selectFiles(input.files); render(); onChange?.(status); } });
  reauth?.addEventListener('click', async () => { await requestStoredPackPermission(); render(); onChange?.(status); });
  render();
}
