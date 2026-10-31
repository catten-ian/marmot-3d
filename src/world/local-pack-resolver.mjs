/** Pure path resolver shared by the DEV picker and deterministic Node tests. */
export const REQUIRED_LOCAL_ASSETS = [
  'assets/verdant/manifest.json',
  'assets/verdant/verdant-trail-height.json',
  'assets/verdant/verdant-trail.glb',
  'assets/models/marmot.glb',
  'assets/models/fox-segmented.glb',
];

export function normalizePath(path) {
  return String(path || '').replaceAll('\\', '/').split('/').filter((part) => part && part !== '.').join('/');
}

function candidates(entries) {
  const groups = new Map();
  for (const [raw, entry] of entries) {
    const normalized = normalizePath(raw);
    const parts = normalized.split('/');
    // The last assets/ segment is the logical runtime root. Earlier segments
    // may be an extracted verdant_trail folder or an outer download folder.
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] !== 'assets') continue;
      const logical = parts.slice(i).join('/');
      if (!REQUIRED_LOCAL_ASSETS.includes(logical)) continue;
      const key = parts.slice(0, i + 1).join('/');
      if (!groups.has(key)) groups.set(key, new Map());
      groups.get(key).set(logical, { raw, entry });
      break;
    }
  }
  return [...groups.entries()].map(([key, files]) => ({ key, files, found: REQUIRED_LOCAL_ASSETS.filter((p) => files.has(p)) }));
}

export function resolveLocalEntries(entries) {
  const list = entries && typeof entries[Symbol.iterator] === 'function' ? entries : new Map(Object.entries(entries || {}));
  const groups = candidates(list);
  if (!groups.length) return { state: 'missing', found: [], missing: REQUIRED_LOCAL_ASSETS.slice(), message: '未找到 assets/verdant/ 优化运行时目录；请选择解压后的 verdant_trail 文件夹或其外层目录。', files: new Map(), candidates: [] };
  const complete = groups.filter((g) => g.found.length === REQUIRED_LOCAL_ASSETS.length);
  const ranked = complete.length ? complete : groups.slice().sort((a, b) => b.found.length - a.found.length);
  const best = ranked[0];
  const tied = ranked.filter((g) => g.found.length === best.found.length);
  if (tied.length > 1) {
    const labels = tied.map((g) => g.key).join('、');
    return { state: 'ambiguous', found: [], missing: REQUIRED_LOCAL_ASSETS.slice(), message: `发现多个同等候选资源根目录：${labels}。请只选择目标 verdant_trail 文件夹，或移除重复副本后重试。`, files: new Map(), candidates: tied.map((g) => g.key) };
  }
  const found = best.found;
  const missing = REQUIRED_LOCAL_ASSETS.filter((p) => !best.files.has(p));
  return { state: missing.length ? 'partial' : 'ready', found, missing, message: missing.length ? `资源包不完整：缺少 ${missing.length} 个文件。请把模型 ZIP 解压并合并到 verdant_trail 文件夹。${best.key ? ` 当前候选：${best.key}` : ''}` : `本地资源包已就绪（${best.key}）`, files: new Map([...best.files].map(([logical, rec]) => [logical, rec.entry])), candidates: [best.key] };
}
