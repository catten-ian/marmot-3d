// 沙盒「迎击练习」纯逻辑：被击退的练习狐在玩家正前方重新出现。
// 抽成纯函数便于 Node 逻辑测试（修复复位回调引用未定义变量 p 的崩溃）。

/**
 * @param {{px?:number, pz?:number, yaw?:number, dist?:number}} args
 *   px/pz 玩家位置（必须在 setTimeout 之前捕获，不能在回调里引用易变对象），
 *   yaw 玩家身体朝向，dist 复位距离（默认 7m）。
 * @returns {{x:number, z:number}} 狐狸复位世界坐标（玩家正前方 dist 米）。
 */
export function drillRespawnPose({ px = 0, pz = 0, yaw = 0, dist = 7 } = {}) {
  const d = Number.isFinite(Number(dist)) ? Number(dist) : 7;
  return {
    x: px + (-Math.sin(yaw)) * d,
    z: pz + (-Math.cos(yaw)) * d,
  };
}

/** 复位练习狐的全部战斗残留：血量/状态/击退速度/跃起高度。返回原对象便于链式调用。 */
export function resetDrillFox(f) {
  if (!f) return f;
  f.hp = f.maxHp;
  f.state = 'roam';
  f.knockbackVX = 0;
  f.knockbackVZ = 0;
  f.leap = 0;
  return f;
}
