/**
 * 真实模型加载器（含分级回退）。
 *
 * 为什么要分级回退：真实模型是"锦上添花"，游戏逻辑不能因为它挂掉。
 * 加载失败的原因在真实环境里很常见：
 *   · 网络/服务器问题（404、传输中断、缓存过期）
 *   · 浏览器解码能力不足（部分环境 HTMLImage 解码失败，只能走 ImageBitmap）
 *   · GLB 格式不合规（自己写的打包脚本出错，chunk 长度或 accessor 偏移算错）
 *   · WebGL 上下文丢失后重建，贴图变成空
 *
 * 回退阶梯（逐级降级，每一级都保证"游戏能跑且看起来正常"）：
 *   L0 完整模型（几何 + 贴图）
 *   L1 仅几何（贴图解码失败 → 用顶点色/纯色）
 *   L2 程序化建模（GLB 完全不可用）
 *
 * 状态通过 getModelStatus() 暴露，UI 可显示当前处于哪一级，
 * 这样"模型没加载出来"时玩家/开发者能立刻知道原因，
 * 而不是看到一只没有毛色的狐狸却不知道发生了什么。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { getAssetCandidatesAsync } from '../world/local-pack.js';

const loader = new GLTFLoader();
const SOFT_TIMEOUT_MS = 15000;
const FINAL_TIMEOUT_MS = 60000;

/** url -> { level, scene, error, geomOnly } */
const cache = new Map();
let assetResolver = null;
export function setAssetResolver(fn) { assetResolver = typeof fn === 'function' ? fn : null; }
function resolveAsset(url) {
  const result = assetResolver ? assetResolver(url) : null;
  const info = result && typeof result === 'object' ? result : (result ? { url: result, source: 'local' } : null);
  const logical = String(url).replace(/^.*?(?=assets\/)/, '');
  const rec = { requestedUrl: url, resolvedUrl: safeResolvedUrl(info?.url || url), source: info?.source || 'server', inPackPath: info?.inPackPath || logical };
  RESOLUTION_STATUS.set(logical, rec);
  return info?.url || url;
}
/** 全局统计，供 UI 展示 */
const STATUS = {
  marmot: { key: 'marmot', logical: 'assets/models/marmot.glb', level: 'pending', error: null, tris: 0, textured: false, source: 'server', requestedUrl: '', resolvedUrl: '' },
  fox: { key: 'fox', logical: 'assets/models/fox-segmented.glb', level: 'pending', error: null, tris: 0, textured: false, source: 'server', requestedUrl: '', resolvedUrl: '' },
};
const RESOLUTION_STATUS = new Map();
function safeResolvedUrl(url) { try { const u = new URL(url, typeof location !== 'undefined' ? location.href : 'http://localhost/'); return u.protocol === 'blob:' ? 'blob://local-pack' : `${u.origin}${u.pathname}`; } catch (_) { return String(url).slice(0, 240); } }
export function getAssetResolutionStatus() { return Object.fromEntries([...RESOLUTION_STATUS].map(([k, v]) => [k, { ...v }])); }
export function clearModelCache() { cache.clear(); for (const key of Object.keys(STATUS)) STATUS[key] = { ...STATUS[key], level: 'pending', error: null, tris: 0, textured: false }; RESOLUTION_STATUS.clear(); }

export function getModelStatus() {
  return JSON.parse(JSON.stringify(STATUS));
}

/**
 * 贴图是否真的解码成功。
 * 不能只看"有没有 map"，必须验证 image 有有效尺寸 ——
 * 解码失败时 three.js 会留下一个 width/height 为 0 的空 texture，
 * 渲染结果是纯白/纯黑，很容易被误判成"加载成功"。
 */
function textureUsable(tex) {
  if (!tex) return false;
  const img = tex.image;
  if (!img) return false;
  const w = img.width || img.videoWidth || img.naturalWidth || 0;
  const h = img.height || img.videoHeight || img.naturalHeight || 0;
  return w > 1 && h > 1;
}

/**
 * 强制所有材质双面渲染。
 *
 * 为什么运行时也要做（而不是只靠 GLB 里的 doubleSided）：
 *   摄影测量网格经顶点聚类简化后，三角形绕序会**一半朝内、一半朝外**
 *   （实测藏狐 49.8% / 50.2%）。默认背面剔除会剔掉约一半的面，
 *   模型渲染成破碎的空壳 —— 在贴地第一人称视角下几乎完全看不见，
 *   而**属性检查全部"正常"**（visible=true、包围盒合理、贴图有像素）。
 *   这类"数据对、画面空"的问题只有靠双面渲染才能兜住。
 *
 * 代价：不过滤背面，填充率略高。对这两个模型（1.5~2 万面）完全可接受。
 */
function forceDoubleSided(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const one = (m) => {
      if (!m) return m;
      if (!m.side || m.side !== THREE_DoubleSide) {
        m.side = THREE_DoubleSide;
        m.needsUpdate = true;
        n++;
      }
      return m;
    };
    if (Array.isArray(o.material)) o.material = o.material.map(one);
    else o.material = one(o.material);
  });
  return n;
}

/** THREE.DoubleSide 的数值（避免在此文件顶层再 import 一次 three 造成循环依赖） */
const THREE_DoubleSide = 2;

/** 剥离无法解码的贴图，退到纯色材质（用顶点色，没有就中性灰） */
function stripTextures(root, label) {
  let stripped = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const one = (m) => {
      if (!m) return m;
      if (!textureUsable(m.map)) {
        if (m.map) {
          m.map.dispose();
          stripped++;
        }
        m.map = null;
        m.needsUpdate = true;
      }
      // 粗糙度/金属度贴图同理
      for (const k of ['roughnessMap', 'metalnessMap', 'normalMap', 'emissiveMap', 'aoMap']) {
        if (m[k] && !textureUsable(m[k])) { m[k] = null; m.needsUpdate = true; }
      }
      // 没有贴图时保留 GLB 的 baseColorFactor；若几何带顶点色，Three.js 仍会使用它。
      // 不强行覆盖材质颜色，否则分块狐狸的棕色 baseColorFactor 会被误改成灰色。
      return m;
    };
    if (Array.isArray(o.material)) o.material = o.material.map(one);
    else o.material = one(o.material);
  });
  if (stripped) console.warn(`[models] ${label}: ${stripped} 张贴图无法解码，已退到纯色材质`);
  return stripped;
}

/**
 * 收集材质上仍在解码（image 尺寸为 0）的贴图。
 * 真机慢盘/高负载时，createImageBitmap 或 HTMLImageElement 解码可能晚于
 * GLTFLoader 的 onLoad 回调一拍；此时直接 strip 会把完好贴图永久剥成纯色，
 * 迟到的解码结果再也换不回来。
 */
function collectPendingTextures(root) {
  const set = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m) continue;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
        if (m[k] && !textureUsable(m[k])) set.add(m[k]);
      }
    }
  });
  return [...set];
}

/**
 * 等待「已挂载但尚未解码完」的贴图就绪。
 * 贴图对象本身保持挂载：实体材质是它的浅拷贝，解码完成后 needsUpdate
 * 会让 GPU 重新上传，迟到的真实毛色能自动换上，无需重建实体。
 * @returns {Promise<{ready:number, failed:Texture[]}>}
 */
function waitForPendingTextures(root, { timeoutMs = 10000, intervalMs = 100 } = {}) {
  return new Promise((resolve) => {
    let pending = collectPendingTextures(root);
    if (!pending.length) { resolve({ ready: 0, failed: [] }); return; }
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const still = [];
      let ready = 0;
      for (const tex of pending) {
        if (textureUsable(tex)) {
          tex.needsUpdate = true; // GPU 侧重新上传迟到的解码结果
          ready++;
          continue;
        }
        const img = tex.image;
        // HTMLImageElement：主动催促解码；ImageBitmap 没有 decode()。
        if (img && typeof img.decode === 'function' && !img.__decodeTried) {
          img.__decodeTried = true;
          Promise.resolve(img.decode()).then(() => { tex.needsUpdate = true; }).catch(() => {});
        }
        still.push(tex);
      }
      pending = still;
      if (!pending.length) { resolve({ ready, failed: [] }); return; }
      if (Date.now() >= deadline) { resolve({ ready, failed: pending }); return; }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

/** 统计三角面数（用于状态展示） */
function countTris(root) {
  let tris = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const idx = o.geometry.index;
    tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
  });
  return Math.round(tris);
}

/**
 * 加载模型。明确失败时 resolve(null)；慢加载不因软超时被取消或缓存成 null。
 *
 * @returns Promise<{scene: Object3D, level: string, textured: boolean}|null>
 */
export function loadModel(url, key = '') {
  if (cache.has(url)) return cache.get(url);

  let pendingPromise;
  const p = new Promise((resolve) => {
    // 15s 是软超时，不是取消加载：实例已先显示程序化版本，
    // 因此慢模型继续加载也不会阻塞游戏；迟到成功仍应替换回真实模型。
    let settled = false;
    let finalTimer;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(finalTimer);
      resolve(v);
    };
    const timer = setTimeout(() => {
      if (key && STATUS[key]) {
        STATUS[key].level = 'loading-slow';
        STATUS[key].error = '仍在加载；程序化模型保持可见';
      }
      console.warn('[models] 加载较慢（15s），继续等待；程序化模型保持可见:', url);
    }, SOFT_TIMEOUT_MS);
    finalTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (key && STATUS[key]) { STATUS[key].level = 'timeout'; STATUS[key].error = '模型加载超过 60 秒，已释放待加载状态，可重试'; }
      if (cache.get(url) === pendingPromise) cache.delete(url);
      console.warn('[models] 加载终态超时（60s），清理 pending cache:', url);
      resolve(null);
    }, FINAL_TIMEOUT_MS);

    const tier = typeof window !== 'undefined' ? (window.__VERDANT_ACTIVE_TIER__ || 'medium') : 'medium';
    let candidates = [];
    const tryCandidate = (candidateIndex) => {
      if (settled) return;
      const candidate = candidates[candidateIndex];
      if (!candidate) {
        if (key && STATUS[key]) { STATUS[key].level = 'failed'; STATUS[key].error = 'local → TOS → source 均无法加载'; }
        done(null); return;
      }
      loader.load(candidate,
      (gltf) => {
        if (settled) { gltf.scene?.traverse?.((o) => { if (o.isMesh) { o.geometry?.dispose?.(); const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => m?.dispose?.()); } }); return; }
        const root = gltf.scene;
        if (!root) {
          if (key && STATUS[key]) { STATUS[key].level = 'empty'; STATUS[key].error = '场景为空'; }
          done(null);
          return;
        }

        // —— L1 判定：贴图是否可用 ——
        // 注意：贴图「已挂载但还在解码」不能立刻剥掉——真机高负载下解码会
        // 晚于 onLoad 一拍，立即 strip 会把完好的狼毛色永久退成纯色。
        let textured = false;
        root.traverse((o) => {
          if (!o.isMesh) return;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) if (m && textureUsable(m.map)) textured = true;
        });
        let pendingTextures = textured ? [] : collectPendingTextures(root);
        if (!textured && !pendingTextures.length) {
          stripTextures(root, key || url);
        } else if (pendingTextures.length) {
          if (key && STATUS[key]) {
            STATUS[key].level = 'texture-pending';
            STATUS[key].error = '贴图解码中，先挂载实体、就绪后自动换上';
          }
          console.info(`[models] ${key || url}: ${pendingTextures.length} 张贴图解码中，延迟剥离判定`);
          // 不 await：模型先给实体使用；贴图对象共享，解码完成后自动换图。
          waitForPendingTextures(root).then(({ ready, failed }) => {
            failed.forEach((tex) => { tex.dispose?.(); });
            // 只剥离最终仍失败的贴图。
            root.traverse((o) => {
              if (!o.isMesh) return;
              const one = (m) => {
                if (!m) return m;
                for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
                  if (m[k] && failed.includes(m[k])) { m[k] = null; m.needsUpdate = true; }
                }
                return m;
              };
              if (Array.isArray(o.material)) o.material = o.material.map(one);
              else o.material = one(o.material);
            });
            const ok = ready > 0;
            if (key && STATUS[key]) {
              STATUS[key].level = ok ? 'full' : 'geometry-only';
              STATUS[key].textured = ok;
              STATUS[key].error = ok ? null : '贴图解码超时，已退到纯色材质';
            }
            console.info(`[models] ${key || url}: 迟到贴图就绪 ${ready} 张，失败 ${failed.length} 张`);
          });
        }

        const tris = countTris(root);
        if (tris < 8) {
          // 几何体是空的 —— 视为不可用，走程序化
          console.warn(`[models] ${url} 几何体为空（${tris} 面），回退`);
          if (key && STATUS[key]) { STATUS[key].level = 'empty-geometry'; STATUS[key].error = `${tris} 面`; }
          done(null);
          return;
        }

        // 强制双面渲染（详见 forceDoubleSided 的注释）——
        // 单面渲染下简化后的摄影测量网格会渲染成空壳，画面上完全看不见。
        const dblSided = forceDoubleSided(root);
        if (dblSided) {
          console.info(`[models] ${key || url}: ${dblSided} 个材质已设为双面渲染` +
            '（简化后的摄影测量网格绕序不一致，单面会渲染成空壳）');
        }

        const level = textured ? 'full' : (pendingTextures.length ? 'texture-pending' : 'geometry-only');
        if (key && STATUS[key]) {
          STATUS[key].level = level;
          STATUS[key].error = level === 'texture-pending' ? '贴图解码中，就绪后自动换上' : null;
          STATUS[key].tris = tris;
          STATUS[key].textured = textured;
        }
        console.info(`[models] ${key || url} 加载成功 [${level}] ${tris.toLocaleString()} 面`);
        done({ scene: root, level, textured: textured || pendingTextures.length > 0, texturesPending: pendingTextures.length, tris, animations: gltf.animations || [] });
      },
      undefined,
      (err) => {
        if (settled) return;
        const msg = (err && (err.message || err.type)) || String(err);
        if (candidateIndex + 1 < candidates.length) { console.warn('[models] 资源回退：', candidate, msg); tryCandidate(candidateIndex + 1); return; }
        clearTimeout(timer);
        console.warn('[models] local → TOS → source 均加载失败，回退到程序化建模:', url, msg);
        if (key && STATUS[key]) { STATUS[key].level = 'failed'; STATUS[key].error = msg; }
        done(null);
      });
    };
    getAssetCandidatesAsync(new URL(url, location.href).href, tier, false, assetResolver).then((urls) => { candidates = urls; tryCandidate(0); }, () => done(null));
  });

  pendingPromise = p;
  cache.set(url, p);
  return p;
}

/**
 * 取模型的一个独立实例（深拷贝材质，避免共享导致的染色冲突）。
 * 失败返回 null —— 调用方负责切回程序化建模。
 */
export async function instantiate(url, key = '') {
  const rec = await loadModel(url, key);
  if (!rec) return null;
  // SkeletonUtils.clone makes each skinned model instance retain an independent bone hierarchy.
  const clone = cloneSkeleton(rec.scene);
  clone.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    // 深拷贝材质：不同个体的染色（如首领偏深）互不影响
    if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
    else if (o.material) o.material = o.material.clone();
    // clone 后再确认一次双面 —— 材质深拷贝不会丢 side，
    // 但若外部传入的 GLB 没有 doubleSided，这里是最后一道保险。
    const one = (m) => { if (m) { m.side = THREE_DoubleSide; m.needsUpdate = true; } return m; };
    if (Array.isArray(o.material)) o.material = o.material.map(one);
    else o.material = one(o.material);
  });
  clone.userData.level = rec.level;
  clone.userData.textured = rec.textured;
  clone.userData.animations = rec.animations || [];
  return clone;
}

/**
 * 预加载：并行拉取模型，避免首次出现时才卡顿。
 * 用 allSettled —— 任何一个失败都不该影响另一个，更不该影响游戏。
 */
export function preloadModels(baseUrl = './assets/models/', opts = {}) {
  const marmot = loadModel(`${baseUrl}${opts.marmotFile || 'marmot.glb'}`, 'marmot');
  // dev 版实际使用分块狐狸；预加载必须和 Fox 的运行时路径一致，
  // 否则启动时白白加载 fox.glb，真正的 fox-segmented.glb 仍会在首只狐狸出现时竞态。
  const fox = loadModel(`${baseUrl}${opts.foxFile || 'fox.glb'}`, 'fox');
  // 以全局 STATUS 为准：它能区分 full / geometry-only / timeout / failed / empty，
  // 仅看 promise 值会把"超时后 resolve(null)"和"真失败"都笼统报成 failed。
  const snapshot = () => ({
    marmot: STATUS.marmot.level,
    fox: STATUS.fox.level,
  });
  // 游戏启动不 await 这个 Promise；保持等待真实终态可避免先返回 loading-slow
  // 后 UI 状态永久过期。若 loader 无回调，实例仍显示程序化版本，慢超时只更新 STATUS。
  return Promise.allSettled([marmot, fox]).then(snapshot);
}

/**
 * 贴图/GPU 上下文丢失后重新验证已缓存模型的贴图是否仍可用。
 * 遍历已 resolve 的缓存，剥离解码尺寸为 0 的失效贴图（退纯色），
 * 返回被剥离的贴图数量。异步：缓存里是 promise，需要 await。
 */
export async function revalidateTextures() {
  let bad = 0;
  for (const [url, p] of cache) {
    let rec;
    try { rec = await p; } catch { continue; }
    if (!rec || !rec.scene) continue;
    // stripTextures 遍历并剥离解码尺寸为 0 的失效贴图，返回剥离数量
    const stripped = stripTextures(rec.scene, url);
    if (stripped > 0 && rec.textured) {
      bad += stripped;
      rec.textured = false;
      rec.level = 'geometry-only';
      const key = url.includes('marmot') ? 'marmot' : url.includes('fox') ? 'fox' : '';
      if (key && STATUS[key]) { STATUS[key].level = 'geometry-only'; STATUS[key].textured = false; }
    }
  }
  return bad;
}

/**
 * 把 GLB 模型贴地并按高度归一。
 *
 * GLB 节点自身的姿态必须保留：fox.glb/marmot.glb 的 root 自带 +90° X，
 * 而 fox-segmented.glb 原生就是 Y-up。这里不覆盖 rotation/quaternion，
 * 只负责包围盒贴地、水平居中与高度缩放。模型前向修正由调用方放在
 * 返回的 wrap 层，和实体逻辑 yaw 完全隔离。
 */
export function normalizeModel(obj, targetHeight = null, opts = {}) {
  const { upAxis = 'native' } = opts;
  obj.updateMatrixWorld(true);

  // 按保留原始节点姿态后的世界包围盒贴地、水平居中。
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  obj.position.set(-center.x, -box.min.y, -center.z);
  obj.updateMatrixWorld(true);

  const inner = new THREE.Group();
  inner.add(obj);
  let appliedScale = 1;
  if (targetHeight && size.y > 0.0001) {
    appliedScale = targetHeight / size.y;
    inner.scale.setScalar(appliedScale);
  }

  const wrap = new THREE.Group();
  wrap.add(inner);

  return {
    wrap,
    size,
    center,
    appliedScale,
    height: size.y * appliedScale,
    debug: {
      upAxis,
      srcSize: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)],
      objScale: obj.scale.x, innerScale: inner.scale.x, wrapScale: wrap.scale.x,
    },
  };
}
