/**
 * PAF Stage 1 测试共用：从 play-as-fox.js 源码文本中安全取出 PAF_DEFAULTS。
 * play-as-fox.js 依赖 three，无法在纯 Node 下 import；PAF_DEFAULTS 本体是
 * 纯字面量对象，这里做括号配对截取 + 间接 eval，避免与实现产生第二份手写默认值。
 */
const fs = require('node:fs');
const path = require('node:path');

function loadPafDefaults() {
  const file = path.join(__dirname, '..', 'src', 'play', 'play-as-fox.js');
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('export const PAF_DEFAULTS = {');
  if (start < 0) throw new Error('PAF_DEFAULTS not found');
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { i = j; break; } }
  }
  const literal = src.slice(src.indexOf('{', start), i + 1);
  // 仅含数值字面量与注释，Function 构造在沙箱外也不触网/不碰 three
  return Function(`"use strict"; return (${literal});`)();
}

module.exports = { loadPafDefaults };
