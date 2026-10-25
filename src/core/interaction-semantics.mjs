/** Version-specific player-facing meaning of the shared `interact` input action. */
const STABLE_INTERACTION = Object.freeze({
  actionLabel: '救援/陪伴',
  skillLabel: '救援/陪伴',
  hudLabel: '陪伴',
  titleHelp: '救援 / 陪伴缓压',
  pauseHelp: '救援',
  help: '救援 / 陪伴',
  touchLabel: '交互',
  touchAria: '救援或陪伴',
});

const BETA_INTERACTION = Object.freeze({
  actionLabel: '啃草/采花',
  skillLabel: '啃草',
  hudLabel: '啃草',
  hudDetail: '草地或花旁按住',
  titleHelp: '按住啃草 / 采花',
  pauseHelp: '按住啃草 / 采花',
  help: '按住啃草 / 采花',
  touchHelp: '第一人称左摇杆左右转向、前后移动（可同时）；第三人称按摇杆方向移动 · 右侧拖动视角 · 触屏按钮可攻击、疾行、跳跃、啃草/采花与释放技能。',
  touchLabel: '啃草',
  touchAria: '按住啃食草或采花',
  grassPrompt: '按住啃草',
  flowerPrompt: '按住采花',
  ready: '靠近草地或花按住',
});

export function interactionSemantics(beta = false) {
  return beta ? BETA_INTERACTION : STABLE_INTERACTION;
}

/** Beta skill state deliberately has no dependency on rescue/companion state. */
export function betaInteractionSkillState({ available = false, held = false, kind = 'grass' } = {}) {
  return {
    label: BETA_INTERACTION.skillLabel,
    state: available && held ? 'active' : 'ready',
    sub: available && held ? (kind === 'flower' ? '采花中' : '啃食中') : BETA_INTERACTION.ready,
  };
}
