/**
 * 从当前键位方案生成给玩家看的提示。
 *
 * 所有教学文案都必须经过这里取键名，禁止在标题、暂停、HUD、toast 中
 * 直接写 J/K/E —— 优化方案的 burst/ultimate/interact 分别是 Q/R/F。
 */
import { Keybinds } from './keybinds.js';

// HUD 在 binds 创建之前就实例化，因此用一个延迟注册的“当前方案”，
// main.js 在创建 Keybinds 后调用 setHintBinds()。
let activeBinds = null;
export function setHintBinds(binds) { activeBinds = binds; }

export function bindText(binds, actionId, fallback = '—') {
  const source = binds || activeBinds;
  const text = source ? source.keys(actionId).map(Keybinds.pretty).filter(Boolean).join(' / ') : '';
  return text || fallback;
}

export function schemeHints(binds, { isDev = false } = {}) {
  const turning = isDev && binds.scheme === 'optimized';
  let movement;
  if (turning) {
    movement = `${bindText(binds, 'forward')} / ${bindText(binds, 'back')} 前后 · ${bindText(binds, 'turnLeft')} / ${bindText(binds, 'turnRight')} 转向 · 方向键横移`;
  } else if (binds.scheme === 'optimized') {
    // 正式版优化方案不占 A/D：前后 W/S，左右横移交给方向键。
    movement = `${bindText(binds, 'forward')} / ${bindText(binds, 'back')} 前后 · 方向键左右横移`;
  } else {
    const wasd = ['forward', 'left', 'back', 'right']
      .map((id) => bindText(binds, id, '')).filter(Boolean).join('');
    movement = `${wasd} 移动（方向键备选）`;
  }

  return {
    movement,
    turning,
    attack: ['鼠标左键', bindText(binds, 'attack', '')].filter(Boolean).join(' / '),
    parry: ['鼠标中键', bindText(binds, 'parry', '')].filter(Boolean).join(' / '),
    jump: [bindText(binds, 'jump', ''), '鼠标右键'].filter(Boolean).join(' / '),
    dodge: bindText(binds, 'dodge'),
    burst: bindText(binds, 'burst'),
    ultimate: bindText(binds, 'ultimate'),
    interact: bindText(binds, 'interact'),
    sprint: bindText(binds, 'sprint'),
    pause: bindText(binds, 'pause'),
    retry: bindText(binds, 'retry'),
    restart: bindText(binds, 'restart'),
  };
}

export function kbd(text) {
  return text ? `<kbd>${text}</kbd>` : '';
}
