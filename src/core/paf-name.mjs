/** Shared PAF leaderboard name contract. */
export const PAF_NAME_MIN_LENGTH = 5;
export const PAF_NAME_MAX_LENGTH = 24;
export const PAF_NAME_RE = /^[\p{L}\p{N}_]+$/u;

export function normalizePafName(value) {
  if (typeof value !== 'string') return { ok: false, error: '请输入名字' };
  const name = value.trim();
  const length = Array.from(name).length;
  if (!name) return { ok: false, error: '请输入名字' };
  if (length < PAF_NAME_MIN_LENGTH) return { ok: false, error: `名字至少 ${PAF_NAME_MIN_LENGTH} 个字母/数字/下划线` };
  if (length > PAF_NAME_MAX_LENGTH) return { ok: false, error: `名字最多 ${PAF_NAME_MAX_LENGTH} 个字母/数字/下划线` };
  if (!PAF_NAME_RE.test(name)) return { ok: false, error: '名字只能使用 Unicode 字母、数字或下划线，不能含空白或控制字符' };
  return { ok: true, value: name, key: name.toLocaleLowerCase() };
}

export function isValidPafName(value) {
  return normalizePafName(value).ok;
}
