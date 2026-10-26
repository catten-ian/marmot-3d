/**
 * 未定义标识符静态扫描（补 node --check 的盲区）。
 *
 * node --check 只做语法解析，查不出 "用了某个 import 进来却没 import 的符号"
 * 这类 ReferenceError 级缺陷 —— 2026-10-26 dev-burrow 任务就是被这个漏掉的。
 *
 * 做法：每个 src 下的 .js/.mjs 文件里
 *   1) 收集 import 的绑定名（含 `as` 别名）
 *   2) 收集本文件声明的顶层名字（const/let/var/function/class/import）
 *   3) 找出"看起来像模块级常量或已导出函数"的大写/驼峰标识符引用，
 *      若它既不在 import 也不在本地声明，且不是已知全局量，则报出来。
 *
 * 只报"高置信"结果，避免把局部变量、属性名、标签名当成缺陷。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const GLOBALS = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date', 'RegExp', 'Error',
  'TypeError', 'RangeError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect', 'ArrayBuffer',
  'Uint8Array', 'Uint16Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'Int8Array', 'Int16Array', 'Int32Array',
  'Intl', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'console', 'window', 'document',
  'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'Image', 'Audio', 'Blob', 'File', 'FileReader',
  'FormData', 'Headers', 'Request', 'Response', 'AbortController', 'Event', 'CustomEvent', 'HTMLElement', 'Element',
  'Node', 'Canvas', 'WebGLRenderingContext', 'self', 'globalThis', 'undefined', 'NaN', 'Infinity', 'isFinite', 'isNaN',
  'parseInt', 'parseFloat', 'structuredClone', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'crypto', 'process',
  'exports', 'module', 'require', '__dirname', '__filename', 'WeakRef', 'FinalizationRegistry', 'Atomics', 'SharedArrayBuffer',
  'Intl', 'escape', 'unescape', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'WebSocket', 'Worker', 'MessageChannel', 'BroadcastChannel', 'Notification', 'matchMedia', 'getComputedStyle',
  'requestIdleCallback', 'cancelIdleCallback', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
  'HTMLCanvasElement', 'HTMLImageElement', 'SVGElement', 'CSS', 'DOMParser', 'XMLHttpRequest', 'SpeechSynthesis',
  'AudioContext', 'OfflineAudioContext', 'GainNode', 'PointerEvent', 'TouchEvent', 'KeyboardEvent', 'MouseEvent',
  'WheelEvent', 'FocusEvent', 'StorageEvent', 'PromiseRejectionEvent', 'globalThis', 'structuredClone',
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');

  // 1) import 绑定
  const imported = new Set();
  const importRe = /import\s+([^'"]+?)\s+from\s*['"]/g;
  let m;
  while ((m = importRe.exec(src))) {
    const clause = m[1];
    const braced = clause.match(/\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const as = t.match(/\s+as\s+([A-Za-z_$][\w$]*)$/);
        imported.add(as ? as[1] : t.replace(/^type\s+/, ''));
      }
    }
    const def = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    for (const part of def.split(/\s+/)) {
      if (!part || part === '*' || part === 'as' || part.startsWith('*')) continue;
      imported.add(part);
    }
  }
  // export { x } 也算本文件内声明
  for (const em of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of em[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.match(/\s+as\s+([A-Za-z_$][\w$]*)$/);
      imported.add(as ? as[1] : t.replace(/^type\s+/, ''));
    }
  }
  // export const/let/function/class X
  for (const em of src.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) {
    imported.add(em[1]);
  }

  // 2) 本文件声明的顶层名（含任意作用域，作为白名单）
  const declared = new Set();
  for (const dm of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(dm[1]);
  for (const dm of src.matchAll(/\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) declared.add(dm[1]);
  for (const dm of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) declared.add(dm[1]);
  for (const dm of src.matchAll(/\bfunction\s*\(([^)]*)\)/g)) {
    for (const part of dm[1].split(',')) {
      const t = part.trim().split(/[=\s]/)[0];
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
    }
  }
  for (const dm of src.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const part of dm[1].split(',')) {
      const t = part.trim().split(/[=\s]/)[0];
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
    }
  }
  for (const dm of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(dm[1]);
  for (const dm of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) declared.add(dm[1]);
  for (const dm of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>\s*\{/g)) declared.add(dm[1]);
  // 解构赋值
  for (const dm of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of dm[1].split(',')) {
      const t = part.trim().split(/[:=]/)[0].trim();
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
    }
  }

  // 3) 候选标识符引用：只关注模块级常量（全大写 + 至少 3 位，本仓库惯例：
  //    USE_REAL_MODELS / IS_DEV / PAF_DEFAULTS / SMART_POUNCE_STAGE ...）。
  //    普通 camelCase 局部变量与解构参数误报率过高，不纳入。
  const stripComments = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const refs = new Map();
  const useRe = /(?<![.\w$'"`])([A-Z][A-Z0-9_]{2,})\s*(?=[({[,;)\s=!+\-*/<>?:])/g;
  let um;
  while ((um = useRe.exec(stripComments))) {
    const name = um[1];
    if (GLOBALS.has(name)) continue;
    if (imported.has(name) || declared.has(name)) continue;
    if (refs.has(name)) continue;
    refs.set(name, stripComments.slice(0, um.index).split('\n').length);
  }

  // 4) 排除解构来源：名字若出现在任何 {...} 模式里，视为解构绑定而非未定义引用
  const destructured = new Set();
  for (const dm of src.matchAll(/\{([^{}]*)\}/g)) {
    for (const part of dm[1].split(',')) {
      const t = part.trim().split(/[:=]/)[0].trim();
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) destructured.add(t);
    }
  }

  const problems = [];
  for (const [name, line] of refs) {
    if (destructured.has(name)) continue;
    problems.push({ name, line });
  }
  return problems;
}

const files = walk(SRC);
let total = 0;
for (const f of files) {
  const ps = scan(f);
  if (ps.length) {
    console.log(`\n${path.relative(ROOT, f)}`);
    for (const p of ps) console.log(`  L${p.line}  ${p.name}`);
    total += ps.length;
  }
}
console.log(`\n=== 扫描 ${files.length} 个文件，候选 ${total} 处 ===`);
console.log('（人工判读：局部变量/解构/属性同名会产生误报）');
