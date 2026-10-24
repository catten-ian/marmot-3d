/** BETA 登录态只保存 token 与公开用户信息；所有存储访问均在函数调用时执行。 */
function getStorage(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object' || user.id === undefined || user.name === undefined) return null;
  return { id: user.id, name: String(user.name), guest: user.guest === true };
}

function normalizeSession(value) {
  if (!value || typeof value !== 'object' || typeof value.token !== 'string' || !value.token) return null;
  const user = normalizeUser(value.user);
  return user ? { token: value.token, user } : null;
}

export function readSession(storage, storageKey = 'm3d.beta.session.v1') {
  const target = getStorage(storage);
  if (!target) return null;
  try { return normalizeSession(JSON.parse(target.getItem(storageKey) || 'null')); } catch (_) { return null; }
}

export function writeSession(token, user, storage, storageKey = 'm3d.beta.session.v1') {
  const target = getStorage(storage);
  const session = normalizeSession({ token, user });
  if (!target || !session) return null;
  try {
    target.setItem(storageKey, JSON.stringify(session));
    return session;
  } catch (_) { return null; }
}

export function clearSession(storage, storageKey = 'm3d.beta.session.v1') {
  const target = getStorage(storage);
  if (!target) return false;
  try { target.removeItem(storageKey); return true; } catch (_) { return false; }
}

export function isUnauthorized(error) { return Number(error?.status) === 401; }

/** 静默恢复；仅明确 401 时清除失效 token，网络故障时保留本地登录态供稍后重试。 */
export async function restoreSession(api, storage, storageKey = 'm3d.beta.session.v1') {
  const cached = readSession(storage, storageKey);
  if (!cached) return { session: null, checked: false, invalid: false };
  try {
    const response = await api.me(cached.token);
    const user = normalizeUser(response?.user);
    if (!user) return { session: cached, checked: true, invalid: false };
    const refreshed = writeSession(cached.token, user, storage, storageKey) || cached;
    return { session: refreshed, checked: true, invalid: false };
  } catch (error) {
    if (isUnauthorized(error)) {
      clearSession(storage, storageKey);
      return { session: null, checked: true, invalid: true };
    }
    return { session: cached, checked: false, invalid: false, error };
  }
}
