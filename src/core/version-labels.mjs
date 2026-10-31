/** Human-readable identifiers shared by the badge and analytics metadata. */
export const STABLE_VERSION_LABEL = '正式版 · v1.0';
export const DEV_VERSION_LABEL = 'DEV · A Verdant Trail 环境 + 旱獭生态';

export function versionBadgeLabel(mode = 'stable') {
  return mode === 'dev' ? DEV_VERSION_LABEL : STABLE_VERSION_LABEL;
}
