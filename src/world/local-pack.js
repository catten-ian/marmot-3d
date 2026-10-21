/** Dev-only local resource-pack directory picker and resolver. */
import { REQUIRED_LOCAL_ASSETS, normalizePath, resolveLocalEntries } from './local-pack-resolver.mjs';
const DB_NAME = 'marmot3d-local-pack';
const STORE = 'handles';
const KEY = 'verdant-dev-pack';
const REQUIRED = REQUIRED_LOCAL_ASSETS;
const canFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
let active = null;
let status = { state: 'none', found: [], missing: REQUIRED.slice(), required: REQUIRED.slice(), candidates: [], rootName: '', message: '未选择本地资源包' };
const changeListeners = new Set();
function openDb() { return new Promise((resolve, reject) => { if (!('indexedDB' in window)) return resolve(null); const req = indexedDB.open(DB_NAME, 1); req.onupgradeneeded = () => req.result.createObjectStore(STORE); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
async function saveHandle(handle) { try { const db = await openDb(); if (!db) return; await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(handle, KEY); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); } catch (_) {} }
async function readHandle() { try { const db = await openDb(); if (!db) return null; return await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).get(KEY); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error); }); } catch (_) { return null; } }
async function walk(dir, prefix = '') { const out = new Map(); for await (const entry of dir.values()) { const path = prefix ? `${prefix}/${entry.name}` : entry.name; if (entry.kind === 'file') out.set(path, entry); else for (const [k, v] of await walk(entry, path)) out.set(k, v); } return out; }
async function validate(root, entries) {
  const raw = entries || await walk(root);
  const result = resolveLocalEntries(raw);
  status = { ...result, required: REQUIRED.slice(), rootName: result.candidates?.[0] || '' };
  const urls = new Map();
  for (const path of result.found) { const entry = result.files.get(path); if (entry) urls.set(path, URL.createObjectURL(await entry.getFile())); }
  active = { root, files: result.files, urls };
  return status;
}
async function selectDirectory() { if (!canFS) throw new Error('当前浏览器不支持目录选择，请使用文件夹选择框'); const root = await window.showDirectoryPicker({ mode: 'read' }); const result = await validate(root); if (result.state === 'ready') await saveHandle(root); return result; }
async function selectFiles(fileList) { const entries = new Map(); for (const file of fileList) entries.set(normalizePath(file.webkitRelativePath || file.name), { getFile: async () => file }); return validate({ name: (fileList[0]?.webkitRelativePath || '').split('/')[0] || 'selected-pack' }, entries); }
export async function restoreLocalPack() { if (!canFS) return status; const handle = await readHandle(); if (!handle) return status; try { const permission = await handle.queryPermission({ mode: 'read' }); if (permission !== 'granted') { status = { ...status, state: 'needs-permission', message: '已记住资源包，请重新授权读取目录' }; return status; } return validate(handle); } catch (_) { return status; } }
export async function requestStoredPackPermission() { const handle = await readHandle(); if (!handle?.requestPermission) return status; const permission = await handle.requestPermission({ mode: 'read' }); if (permission === 'granted') return validate(handle); status = { ...status, state: 'needs-permission', message: '未获得目录读取权限' }; return status; }
export function getLocalPackStatus() { return { ...status, required: REQUIRED.slice() }; }
export function getLocalPackAssetInfo(path) {
  const logical = normalizePath(path).replace(/^.*?(?=assets\/)/, '');
  const url = active?.urls.get(logical) || null;
  return url ? { url, source: 'local', inPackPath: logical, rootName: status.rootName || '' } : null;
}
export function resolveLocalAsset(path) { return getLocalPackAssetInfo(path)?.url || null; }
function notifyChange() { for (const fn of changeListeners) { try { fn(getLocalPackStatus()); } catch (_) {} } }
function renderLocalPackStatus(box, reauth) {
  if (!box) return;
  const s = getLocalPackStatus();
  box.innerHTML = `<b>${s.message}</b><br><small>已找到 ${s.found.length}/${s.required.length} 个文件${s.found.length ? `<br>已找到：${s.found.join('、')}` : ''}${s.missing.length ? `<br>缺少：${s.missing.join('、')}` : ''}<br>请选择包含 verdant_trail/assets/ 的文件夹；ZIP 必须先解压。blend 与 textures/ 为源文件，不能替代 assets/verdant/ 优化文件。</small>`;
  if (reauth) reauth.hidden = s.state !== 'needs-permission';
}
async function choosePack() {
  try { await selectDirectory(); notifyChange(); }
  catch (e) { if (e?.name !== 'AbortError') { status = { ...status, state: 'error', message: e.message }; notifyChange(); } }
}
export function installLocalPackUI({ onChange } = {}) {
  if (typeof document === 'undefined') return;
  if (typeof onChange === 'function') changeListeners.add(onChange);
  const buttons = [...document.querySelectorAll('#localPackChoose, [data-local-pack-choose]')];
  const inputs = [...document.querySelectorAll('#localPackInput, [data-local-pack-input]')];
  const reauths = [...document.querySelectorAll('#localPackReauth, [data-local-pack-reauth]')];
  const boxes = [...document.querySelectorAll('#localPackStatus, [data-local-pack-status]')];
  // The title DOM is injected after boot. A call with no elements is deliberately harmless.
  if (!buttons.length && !inputs.length && !reauths.length) return;
  const render = () => boxes.forEach((box) => renderLocalPackStatus(box, reauths.find((el) => el.closest('[data-local-pack-root]') === box.closest('[data-local-pack-root]')) || reauths[0]));
  buttons.forEach((button) => {
    if (button.dataset.localPackBound === '1') return;
    button.dataset.localPackBound = '1';
    button.addEventListener('click', async () => {
      if (!canFS) { inputs[0]?.click(); return; }
      await choosePack(); render();
    });
  });
  inputs.forEach((input) => {
    if (input.dataset.localPackBound === '1') return;
    input.dataset.localPackBound = '1';
    input.addEventListener('change', async () => { if (input.files?.length) { await selectFiles(input.files); notifyChange(); render(); } });
  });
  reauths.forEach((button) => {
    if (button.dataset.localPackBound === '1') return;
    button.dataset.localPackBound = '1';
    button.addEventListener('click', async () => { try { await requestStoredPackPermission(); notifyChange(); render(); } catch (e) { if (e?.name !== 'AbortError') throw e; } });
  });
  render();
}
