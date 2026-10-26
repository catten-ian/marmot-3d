function normalizePath(path) { return String(path || '').replaceAll('\\', '/').split('/').filter((part) => part && part !== '.').join('/'); }

function md5Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64, padded = new Uint8Array(paddedLength);
  padded.set(bytes); padded[bytes.length] = 0x80; new DataView(padded.buffer).setBigUint64(paddedLength - 8, BigInt(bytes.length) * 8n, true);
  const k = Uint32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0), shifts = [7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21], rol = (x,n) => (x << n) | (x >>> (32 - n));
  const view = new DataView(padded.buffer); let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  for(let off=0;off<paddedLength;off+=64){let a=a0,b=b0,c=c0,d=d0;for(let i=0;i<64;i++){let f,g,sh;if(i<16){f=(b&c)|(~b&d);g=i;sh=shifts[i%4]}else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;sh=shifts[4+i%4]}else if(i<48){f=b^c^d;g=(3*i+5)%16;sh=shifts[8+i%4]}else{f=c^(b|~d);g=7*i%16;sh=shifts[12+i%4]}const t=(a+f+k[i]+view.getUint32(off+4*g,true))>>>0;a=d;d=c;c=b;b=(b+rol(t,sh))>>>0}a0=(a0+a)>>>0;b0=(b0+b)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0}
  return [a0,b0,c0,d0].flatMap(v=>[v&255,v>>>8&255,v>>>16&255,v>>>24&255]).map(v=>v.toString(16).padStart(2,'0')).join('');
}
function shouldSkipPackFile({ existingSize, existingHash, record }) { const expected = record?.md5 || record?.sha256; return Number.isSafeInteger(existingSize) && existingSize === record?.size && typeof existingHash === 'string' && typeof expected === 'string' && existingHash.toLowerCase() === expected.toLowerCase(); }
function createByteProgress(records) { return { total: records.reduce((n,r)=>n+(Number.isSafeInteger(r?.size)&&r.size>0?r.size:0),0), done:0, skipped:0, filesDone:0 }; }
function recordPackFileDone(progress, size, { skipped = false } = {}) { progress.done = Math.min(progress.total, progress.done + (Number.isSafeInteger(size)&&size>0?size:0)); progress.filesDone++; if(skipped) progress.skipped++; return progress; }
function byteProgressFraction(progress, inFlight = 0) { return progress.total ? Math.max(0, Math.min(1, (progress.done + Math.max(0,inFlight))/progress.total)) : 1; }

/** Dev-only Verdant package picker, integrity validator and tier download hooks. */
const DB_NAME = 'marmot3d-local-pack';
const STORE = 'handles';
const KEY = 'verdant-dev-pack';
const REQUIRED = [
  'pack-manifest.json',
  'assets/verdant/manifest.json',
  'assets/verdant/verdant-trail-height.json',
  'assets/models/marmot.glb',
  'assets/models/wolf.glb',
];
const canFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
let active = null;
let uiInstalled = false;
let status = { state: 'none', found: [], missing: REQUIRED.slice(), message: '未选择本地资源包' };
let downloadState = { state: 'idle', message: '尚未下载' };

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
  try {
    const db = await openDb(); if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* browser persistence is optional */ }
}
async function readHandle() {
  try {
    const db = await openDb(); if (!db) return null;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
    });
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
function normalizeInputPath(input) {
  let p = normalizePath(input);
  try { if (/^[a-z]+:\/\//i.test(p)) p = new URL(p).pathname; } catch (_) {}
  p = p.replace(/^\/+|^\.\//, '');
  const at = p.indexOf('assets/');
  if (at >= 0) return p.slice(at);
  if (p.endsWith('pack-manifest.json')) return 'pack-manifest.json';
  return p;
}
function safeRelative(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/')
    && !path.split(/[\\/]/).some((part) => !part || part === '.' || part === '..');
}
async function sha256(blob) {
  if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持 SHA-256 完整性校验');
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
async function readEntryJson(entry) { return JSON.parse(await (await entry.getFile()).text()); }
async function validate(root, entries, onProgress = null, verifyHashes = true) {
  const files = entries || await walk(root);
  const normalized = new Map();
  for (const [rawPath, entry] of files) normalized.set(normalizeInputPath(rawPath), entry);
  const found = REQUIRED.filter((p) => normalized.has(p));
  const missing = REQUIRED.filter((p) => !found.includes(p));
  if (!normalized.size) { status = { state: 'none', found: [], missing: REQUIRED.slice(), message: '未选择本地资源包' }; active = null; return status; }
  if (missing.length) {
    active = null;
    status = { state: 'partial', found, missing, message: `资源包不完整：缺少 ${missing.length} 个必要文件` };
    return status;
  }

  status = { state: 'verifying', found, missing: [], message: '正在逐文件校验 SHA-256…' };
  onProgress?.(status);
  let packManifest;
  try { packManifest = await readEntryJson(normalized.get('pack-manifest.json')); }
  catch (e) { status = { state: 'error', found, missing: [], message: `pack-manifest.json 无法读取：${e.message}` }; active = null; return status; }
  if (!Array.isArray(packManifest.files) || packManifest.files.length !== packManifest.fileCount) {
    status = { state: 'error', found, missing: [], message: 'pack-manifest.json 的文件数/清单结构不匹配' }; active = null; return status;
  }
  let checked = 0, totalBytes = 0;
  for (const rec of packManifest.files) {
    if (!safeRelative(rec.path) || !Number.isSafeInteger(rec.size) || rec.size < 0 || (!/^[a-f0-9]{64}$/i.test(rec.sha256 || '') && !/^[a-f0-9]{32}$/i.test(rec.md5 || ''))) {
      status = { state: 'error', found, missing: [], message: `pack-manifest.json 条目无效：${rec.path || '(empty)'}` }; active = null; return status;
    }
    const entry = normalized.get(normalizeInputPath(rec.path));
    if (!entry) { missing.push(rec.path); continue; }
    const file = await entry.getFile();
    if (file.size !== rec.size) {
      status = { state: 'error', found, missing, message: `文件大小校验失败：${rec.path}` }; active = null; return status;
    }
    if (verifyHashes && (await sha256(file)) !== rec.sha256.toLowerCase()) {
      status = { state: 'error', found, missing, message: `SHA-256 校验失败：${rec.path}` }; active = null; return status;
    }
    checked++; totalBytes += file.size;
    if (checked % 8 === 0 || checked === packManifest.files.length) {
      status = { state: 'verifying', found, missing: [], message: `已校验 ${checked}/${packManifest.fileCount} 个文件（${(totalBytes / 1e9).toFixed(2)} GB）` };
      onProgress?.(status);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (missing.length) { status = { state: 'partial', found, missing, message: `资源包清单仍缺少 ${missing.length} 个文件` }; active = null; return status; }

  const urls = new Map();
  for (const [rawPath, entry] of normalized) {
    if (!rawPath.startsWith('assets/')) continue;
    try { urls.set(rawPath, URL.createObjectURL(await entry.getFile())); } catch (_) {}
  }
  active = { root, files: normalized, urls, packManifest };
  status = { state: 'ready', found, missing: [], fileCount: packManifest.fileCount, totalBytes: packManifest.totalBytes, tier: packManifest.tier, message: verifyHashes ? `本地 ${packManifest.tier || ''} 资源包已就绪，${checked} 个文件 SHA-256 全部通过` : `本地 ${packManifest.tier || ''} 资源包已就绪，${checked} 个文件大小与清单一致（启动恢复）` };
  onProgress?.(status);
  return status;
}
export async function selectLocalPackDirectory(onProgress) {
  if (!canFS) throw new Error('当前浏览器不支持目录读写，请使用 Chromium/Chrome');
  const root = await window.showDirectoryPicker({ mode: 'read' });
  const result = await validate(root, null, onProgress);
  if (result.state === 'ready') await saveHandle(root);
  return result;
}
export async function selectLocalPackFiles(fileList, onProgress) {
  const entries = new Map();
  for (const file of fileList) entries.set(normalizeInputPath(file.webkitRelativePath || file.name), { getFile: async () => file });
  return validate({ name: (fileList[0]?.webkitRelativePath || '').split('/')[0] || 'selected-pack' }, entries, onProgress);
}
export async function restoreLocalPack(onProgress = null) {
  if (!canFS) return status;
  const handle = await readHandle();
  if (!handle) return status;
  try {
    const permission = await handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') { status = { ...status, state: 'needs-permission', message: '已记住资源包，请重新授权读取目录' }; return status; }
    return validate(handle, null, onProgress, false);
  } catch (_) { return status; }
}
export async function requestStoredPackPermission(onProgress = null) {
  const handle = await readHandle();
  if (!handle?.requestPermission) return status;
  const permission = await handle.requestPermission({ mode: 'read' });
  if (permission === 'granted') return validate(handle, null, onProgress, false);
  status = { ...status, state: 'needs-permission', message: '未获得目录读取权限' }; return status;
}
export function getLocalPackStatus() { return { ...status, required: REQUIRED.slice() }; }
export function getDownloadState() { return { ...downloadState }; }
export function resolveLocalAsset(path) {
  if (!active) return null;
  return active.urls.get(normalizeInputPath(path)) || null;
}
export function getLocalPackAssetInfo(path) { const url = resolveLocalAsset(path); return url ? { url, source: 'local', inPackPath: normalizeInputPath(path) } : null; }

function tosConfig() {
  let cfg = typeof window !== 'undefined' ? window.__VERDANT_TOS__ : null;
  if (!cfg?.baseUrl && typeof localStorage !== 'undefined') { const saved = localStorage.getItem('verdant-tos-base'); if (saved) cfg = { ...(cfg || {}), baseUrl: saved, version: '20261022' }; }
  return cfg && typeof cfg === 'object' && (cfg.baseUrl || cfg.packRoots) ? cfg : null;
}
export function getTosBaseUrl() {
  const cfg = tosConfig();
  return cfg?.baseUrl || '';
}
export function setTosBaseUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    try { localStorage.removeItem('verdant-tos-base'); } catch (_) {}
    if (typeof window !== 'undefined' && window.__VERDANT_TOS__?.baseUrl) {
      const { baseUrl: _base, ...rest } = window.__VERDANT_TOS__;
      window.__VERDANT_TOS__ = Object.keys(rest).length ? rest : null;
    }
    renderLocalPackUi();
    return '';
  }
  let parsed;
  try { parsed = new URL(trimmed, location.href); } catch (_) { throw new Error('TOS URL 格式无效'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('TOS URL 仅接受 HTTP(S)');
  const normalized = parsed.href.replace(/\/+$/, '');
  try { localStorage.setItem('verdant-tos-base', normalized); } catch (_) {}
  if (typeof window !== 'undefined') window.__VERDANT_TOS__ = { ...(window.__VERDANT_TOS__ || {}), baseUrl: normalized, version: '20261022' };
  renderLocalPackUi();
  return normalized;
}
function packRoot(tier) {
  const cfg = tosConfig(); if (!cfg) return null;
  const direct = cfg.packRoots?.[tier];
  if (direct) return new URL(String(direct).endsWith('/') ? direct : `${direct}/`, location.href).href;
  if (!cfg.baseUrl) return null;
  const base = String(cfg.baseUrl).endsWith('/') ? cfg.baseUrl : `${cfg.baseUrl}/`;
  const version = encodeURIComponent(String(cfg.version || '20261022'));
  return new URL(`m3d-dev/${version}/${encodeURIComponent(tier)}/`, base).href;
}
function logicalAssetPath(url) {
  try {
    const parsed = new URL(url, location.href);
    const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    const at = path.indexOf('assets/');
    return at >= 0 ? path.slice(at) : null;
  } catch (_) { return null; }
}
export function getAssetCandidates(url, tier, sourceOnly = false, overrideResolver = null) {
  let source;
  try { source = new URL(url, location.href).href; } catch (_) { source = url; }
  if (sourceOnly) return [source];
  const relative = logicalAssetPath(source);
  if (!relative) return [source];
  const candidates = [];
  const local = (typeof overrideResolver === 'function' ? overrideResolver(source) : null) || resolveLocalAsset(relative);
  if (local) candidates.push(local);
  const root = packRoot(tier);
  if (root) candidates.push(new URL(relative, root).href);
  candidates.push(source);
  return [...new Set(candidates)];
}
export function getTierPackRoot(tier) { return packRoot(tier); }
export function getPreferredAsset(url, tier) { return getAssetCandidates(url, tier)[0] || url; }

function setDownloadUi(message, state = 'working', fraction = 0) {
  downloadState = { state, message, fraction };
  const box = document.getElementById('verdantDownloadStatus');
  if (box) box.textContent = message;
  const progress = document.getElementById('verdantDownloadProgress');
  if (progress) { progress.value = Math.max(0, Math.min(1, Number(fraction) || 0)); progress.setAttribute('aria-valuenow', String(Math.round(progress.value * 100))); }
  try { window.__game?.verdantQuality && (window.__game.verdantQuality.downloadState = { ...downloadState }); } catch (_) {}
}
async function fetchOk(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response;
}
export function downloadVerdantZip(tier) {
  const root = packRoot(tier); if (!root) throw new Error('TOS 未配置，ZIP 下载暂不可用');
  const cfg = tosConfig();
  const zipUrl = cfg.zipUrls?.[tier] || new URL('pack.zip', root).href;
  const anchor = document.createElement('a'); anchor.href = zipUrl; anchor.download = `m3d-dev-${tier}.zip`;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setDownloadUi(`${tier} ZIP 下载已启动；服务端 ZIP 应与文件夹包 manifest 同源。`, 'started', 1);
}
async function hashArrayBuffer(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
async function writePath(root, path, bytes) {
  const parts = path.split('/'); let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const handle = await dir.getFileHandle(parts.at(-1), { create: true });
  const writable = await handle.createWritable(); await writable.write(bytes); await writable.close();
}
async function readExistingPath(root, path) {
  const parts = path.split('/'); let dir = root;
  try {
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const handle = await dir.getFileHandle(parts.at(-1)); return await handle.getFile();
  } catch (_) { return null; }
}
async function readResponseBytes(response, onProgress) {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.(bytes.byteLength);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    chunks.push(value); loaded += value.byteLength; onProgress?.(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function downloadVerdantFolder(tier) {
  if (!canFS) throw new Error('当前浏览器不支持文件夹下载 API');
  const base = packRoot(tier); if (!base) throw new Error('TOS 未配置，文件夹下载暂不可用');
  // Must open picker during the click activation, before any network await.
  const target = await window.showDirectoryPicker({ mode: 'readwrite' });
  setDownloadUi(`读取 ${tier} 包清单…`);
  const manifestResponse = await fetchOk(new URL('pack-manifest.json', base).href);
  const manifestBytes = await manifestResponse.arrayBuffer();
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (manifest.tier !== tier || !Array.isArray(manifest.files) || manifest.files.length !== manifest.fileCount) throw new Error('TOS pack-manifest 与所选档位不匹配');
  const progress = createByteProgress(manifest.files);
  let reused = 0;
  setDownloadUi(`${tier} 字节进度：0/${progress.total} B（已跳过 0）`, 'working', 0);
  for (let i = 0; i < manifest.files.length; i++) {
    const rec = manifest.files[i];
    if (!safeRelative(rec.path) || !Number.isSafeInteger(rec.size) || rec.size < 0
      || !/^[a-f0-9]{64}$/i.test(rec.sha256 || '') || (rec.md5 && !/^[a-f0-9]{32}$/i.test(rec.md5))) {
      throw new Error(`非法 manifest 路径/校验值：${rec.path}`);
    }
    const existing = await readExistingPath(target, rec.path);
    let existingHash = '';
    if (existing && existing.size === rec.size) {
      existingHash = rec.md5 ? await md5Hex(new Uint8Array(await existing.arrayBuffer())) : await sha256(existing);
    }
    if (shouldSkipPackFile({ existingSize: existing?.size, existingHash, record: rec })) {
      recordPackFileDone(progress, rec.size, { skipped: true }); reused++;
      setDownloadUi(`${tier} 字节进度：${progress.done}/${progress.total} B；命中跳过 ${reused} 个；文件 ${i + 1}/${manifest.fileCount}`, 'working', byteProgressFraction(progress));
      continue;
    }
    const response = await fetchOk(new URL(rec.path, base).href);
    let inFlight = 0;
    const bytes = await readResponseBytes(response, (loaded) => {
      inFlight = Math.min(rec.size, loaded);
      setDownloadUi(`${tier} 字节进度：${progress.done + inFlight}/${progress.total} B；当前 ${rec.path}；命中跳过 ${reused} 个`, 'working', byteProgressFraction(progress, inFlight));
    });
    const shaOk = bytes.byteLength === rec.size && await hashArrayBuffer(bytes.buffer);
    const md5Ok = !rec.md5 || md5Hex(bytes) === rec.md5.toLowerCase();
    if (bytes.byteLength !== rec.size || shaOk !== rec.sha256.toLowerCase() || !md5Ok) throw new Error(`下载完整性校验失败：${rec.path}`);
    await writePath(target, rec.path, bytes);
    recordPackFileDone(progress, bytes.byteLength);
    setDownloadUi(`${tier} 字节进度：${progress.done}/${progress.total} B；文件 ${i + 1}/${manifest.fileCount}；命中跳过 ${reused} 个`, 'working', byteProgressFraction(progress));
  }
  await writePath(target, 'pack-manifest.json', manifestBytes);
  await saveHandle(target);
  await validate(target, null, null, false);
  setDownloadUi(`${tier} 文件夹完成：${manifest.fileCount} 个文件已校验；跳过 ${reused} 个（${progress.done}/${progress.total} B），可直接使用该目录。`, 'complete', 1);
}
function renderLocalPackUi() {
  const box = document.getElementById('localPackStatus'); if (!box) return;
  const s = getLocalPackStatus();
  box.textContent = `${s.message}${s.found?.length ? `（已找到 ${s.found.length}/${s.required.length} 个核心文件）` : ''}${s.missing?.length ? `；缺少：${s.missing.join('、')}` : ''}`;
  const reauth = document.getElementById('localPackReauth'); if (reauth) reauth.hidden = s.state !== 'needs-permission';
  const tos = tosConfig();
  const zip = document.getElementById('verdantZipDownload'); const folder = document.getElementById('verdantFolderDownload');
  const tier = document.getElementById('verdantDownloadTier')?.value || 'high';
  if (zip) zip.disabled = !tos;
  if (folder) folder.disabled = !tos || !canFS;
  const tstatus = document.getElementById('verdantTosStatus');
  if (tstatus) tstatus.textContent = tos ? `TOS 已配置（档位：${tier}）` : 'TOS 尚未配置；当前只使用本地资源包与同源服务器资源，不会尝试外网。';
  const downloadBox = document.getElementById('verdantDownloadStatus');
  if (downloadBox && downloadState.state !== 'idle') downloadBox.textContent = downloadState.message;
  const progress = document.getElementById('verdantDownloadProgress');
  if (progress && downloadState.state !== 'idle') progress.value = Math.max(0, Math.min(1, downloadState.fraction || 0));
}
export function installLocalPackUI({ onChange } = {}) {
  if (uiInstalled) return;
  const button = document.getElementById('localPackChoose');
  const input = document.getElementById('localPackInput');
  if (!button && !input) return;
  uiInstalled = true;
  const reauth = document.getElementById('localPackReauth');
  const showProgress = (s) => {
    status = s; renderLocalPackUi(); onChange?.(s);
  };
  button?.addEventListener('click', async () => {
    try {
      const result = canFS ? await selectLocalPackDirectory(showProgress) : await new Promise((resolve) => { input?.click(); resolve(null); });
      if (result) showProgress(result);
    } catch (e) { if (e?.name !== 'AbortError') { status = { ...status, state: 'error', message: e.message }; showProgress(status); } }
  });
  input?.addEventListener('change', async () => {
    if (!input.files?.length) return;
    try { showProgress(await selectLocalPackFiles(input.files, showProgress)); onChange?.(status); }
    catch (e) { status = { ...status, state: 'error', message: e.message }; showProgress(status); }
  });
  reauth?.addEventListener('click', async () => { showProgress(await requestStoredPackPermission(showProgress)); onChange?.(status); });
  document.getElementById('verdantZipDownload')?.addEventListener('click', () => {
    try { downloadVerdantZip(document.getElementById('verdantDownloadTier')?.value || 'high'); }
    catch (e) { setDownloadUi(e.message, 'error'); }
  });
  document.getElementById('verdantFolderDownload')?.addEventListener('click', async () => {
    try { await downloadVerdantFolder(document.getElementById('verdantDownloadTier')?.value || 'high'); }
    catch (e) { if (e?.name !== 'AbortError') setDownloadUi(e.message, 'error'); }
  });
  document.getElementById('verdantDownloadTier')?.addEventListener('change', renderLocalPackUi);
  renderLocalPackUi();
}
