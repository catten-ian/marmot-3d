// 触屏手感常量（纯常量模块，Node 逻辑测试与浏览器共用）。

// 摇杆推过该归一化行程即进入疾跑（sprint threshold）。
// 这就是用户所说的移动轮盘“内圈大小”：决定推到多大范围才判定疾跑，
// 不是装饰圆。可在设置里于 [SPRINT_THRESHOLD_MIN, SPRINT_THRESHOLD_MAX] 间调整，
// 持久化在既有 marmot.touch-layout.v1 的 joystick.sprintThreshold 字段。
export const SPRINT_STICK_THRESHOLD = 0.78;
export const SPRINT_THRESHOLD_MIN = 0.55;
export const SPRINT_THRESHOLD_MAX = 0.95;

export function clampSprintThreshold(v, fallback = SPRINT_STICK_THRESHOLD) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(SPRINT_THRESHOLD_MIN, Math.min(SPRINT_THRESHOLD_MAX, n));
}
