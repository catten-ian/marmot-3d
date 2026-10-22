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
  const profile = binds?.controlProfile || '';
  const turning = isDev ? binds.scheme === 'optimized' : !!binds?.turningEnabled;
  const driving = profile === 'driving';
  const primary = (id) => bindText(binds, id, '');
  const turnText = (side, fallback) => {
    const code = binds?.turnMap?.[side];
    return code ? Keybinds.pretty(code) : fallback;
  };
  const alt = (id) => {
    const code = { forward: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[id];
    return code ? Keybinds.pretty(code) : '';
  };
  let movement;
  if (driving) {
    movement = `${primary('forward')} / ${primary('back')} 前后移动 · ${turnText('left', primary('left') || 'A')} / ${turnText('right', primary('right') || 'D')} 转向（方向键上下前后、左右转向）`;
  } else if (profile === 'dev-optimized-turning' || (isDev && binds.scheme === 'optimized' && turning)) {
    movement = `${primary('forward')} / ${primary('back')} 前后移动 · ${primary('turnLeft')} / ${primary('turnRight')} 转向 · ${alt('left')} / ${alt('right')} 横移`;
  } else if (binds.scheme === 'optimized') {
    movement = `${primary('forward')} / ${primary('back')} 前后移动 · ${primary('left')} / ${primary('right')} 横移（方向键备选）`;
  } else {
    const wasd = ['forward', 'left', 'back', 'right']
      .map((id) => primary(id)).filter(Boolean).join('');
    movement = `${wasd} 移动（方向键备选）`;
  }

  return {
    movement,
    turning,
    driving,
    attack: ['鼠标左键', primary('attack')].filter(Boolean).join(' / '),
    parry: ['鼠标中键', primary('parry')].filter(Boolean).join(' / '),
    jump: [primary('jump'), '鼠标右键'].filter(Boolean).join(' / '),
    dodge: primary('dodge'),
    burst: primary('burst'),
    ultimate: primary('ultimate'),
    interact: primary('interact'),
    sprint: primary('sprint'),
    pause: primary('pause'),
    retry: primary('retry'),
    restart: primary('restart'),
  };
}

export function kbd(text) {
  return text ? `<kbd>${text}</kbd>` : '';
}
