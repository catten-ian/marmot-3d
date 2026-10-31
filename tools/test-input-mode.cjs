/* 输入模式（设置强制 自动/触屏/键鼠）纯逻辑测试：
 *  - 默认 auto；损坏/未知持久化值回退 auto；
 *  - 强制值读写持久化（独立版本 key marmot.input-mode.v1）；
 *  - 自动模式：设备检测 + 首次真实触摸运行时升级；升级不改写用户偏好；
 *  - 强制键鼠：收到真实触摸也不升级；
 *  - 强制触屏：桌面（检测为非触屏）也生效；
 *  - onChange 通知与 describe() 状态表达。
 */
const assert = require('node:assert/strict');

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}
const throwingStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
};

(async () => {
  const m = await import('../src/core/input-mode.mjs');
  const {
    InputModeManager, normalizeInputMode,
    readInputModePreference, writeInputModePreference,
    INPUT_MODE_STORAGE_KEY,
  } = m;
  assert.equal(INPUT_MODE_STORAGE_KEY, 'marmot.input-mode.v1', '独立版本 key');

  // —— 归一化 / 损坏值回退 ——
  assert.equal(normalizeInputMode('auto'), 'auto');
  assert.equal(normalizeInputMode('touch'), 'touch');
  assert.equal(normalizeInputMode('keyboard'), 'keyboard');
  for (const bad of [undefined, null, '', 'banana', 'Touch', '0', '{}', '[]', 1, true]) {
    assert.equal(normalizeInputMode(bad), 'auto', `损坏值 ${String(bad)} 回退 auto`);
  }
  assert.equal(readInputModePreference(makeStorage({ [INPUT_MODE_STORAGE_KEY]: 'banana' })), 'auto', '存储损坏回退 auto');
  assert.equal(readInputModePreference(throwingStorage), 'auto', '存储不可读回退 auto');

  // —— 默认值 ——
  {
    const im = new InputModeManager({ storage: makeStorage(), detectTouch: () => false });
    assert.equal(im.preference, 'auto', '默认偏好 auto');
    assert.equal(im.effective(), 'keyboard', '桌面自动模式默认键鼠');
    assert.equal(im.isTouch(), false);
    assert.equal(im.describe(), 'auto(keyboard)');
  }
  {
    const im = new InputModeManager({ storage: makeStorage(), detectTouch: () => true });
    assert.equal(im.effective(), 'touch', '触屏设备自动模式默认触屏');
    assert.equal(im.describe(), 'auto(touch)');
    assert.equal(im.notifyRealTouch(), false, '已是触屏的自动模式无需升级');
  }

  // —— 自动模式首次真实触摸升级（X5/微信谎报场景）——
  {
    const storage = makeStorage();
    const im = new InputModeManager({ storage, detectTouch: () => false });
    assert.equal(im.canRuntimeUpgrade(), true);
    let fired = 0;
    im.onChange(() => fired++);
    assert.equal(im.notifyRealTouch(), true, '首次真实触摸升级');
    assert.equal(im.effective(), 'touch');
    assert.equal(im.runtimeTouch, true);
    assert.equal(fired, 1, '升级触发一次 onChange');
    assert.equal(im.notifyRealTouch(), false, '重复触摸幂等');
    assert.equal(fired, 1);
    // 关键契约：升级后仍表达“自动 + 当前触屏”，不能写死成用户强制触屏。
    assert.equal(im.preference, 'auto');
    assert.equal(im.describe(), 'auto+runtime-touch');
    assert.equal(storage._map.get(INPUT_MODE_STORAGE_KEY), undefined, '运行时升级不写入持久化');
  }

  // —— 强制键鼠：有触摸点/收到 touchstart 也不升级 ——
  {
    const storage = makeStorage({ [INPUT_MODE_STORAGE_KEY]: 'keyboard' });
    const im = new InputModeManager({ storage, detectTouch: () => true });
    assert.equal(im.preference, 'keyboard');
    assert.equal(im.effective(), 'keyboard', '触屏设备上强制键鼠仍键鼠');
    assert.equal(im.canRuntimeUpgrade(), false);
    assert.equal(im.notifyRealTouch(), false, '强制键鼠不升级');
    assert.equal(im.effective(), 'keyboard');
    assert.equal(im.describe(), 'keyboard');
  }

  // —— 强制触屏：桌面浏览器也生效 ——
  {
    const im = new InputModeManager({ storage: makeStorage({ [INPUT_MODE_STORAGE_KEY]: 'touch' }), detectTouch: () => false });
    assert.equal(im.effective(), 'touch', '桌面强制触屏生效');
    assert.equal(im.notifyRealTouch(), false, '强制触屏无需升级');
    assert.equal(im.describe(), 'touch');
  }

  // —— setPreference 持久化 + 通知 + 切回 auto 重新检测 ——
  {
    const storage = makeStorage();
    let detect = false;
    const im = new InputModeManager({ storage, detectTouch: () => detect });
    const seen = [];
    im.onChange((mgr) => seen.push(mgr.effective()));
    assert.equal(im.setPreference('touch'), 'touch');
    assert.equal(storage._map.get(INPUT_MODE_STORAGE_KEY), 'touch', '强制触屏已持久化');
    assert.equal(im.effective(), 'touch');
    assert.equal(im.setPreference('keyboard'), 'keyboard');
    assert.equal(storage._map.get(INPUT_MODE_STORAGE_KEY), 'keyboard');
    assert.equal(im.effective(), 'keyboard');
    assert.deepEqual(seen, ['touch', 'keyboard'], '每次有效变化都通知');
    // 非法值经 setPreference 也会归一化为 auto 并持久化。
    assert.equal(im.setPreference('banana'), 'auto');
    assert.equal(storage._map.get(INPUT_MODE_STORAGE_KEY), 'auto');
    // 切回 auto 重新做设备检测。
    detect = true;
    im.setPreference('keyboard');
    im.setPreference('auto');
    assert.equal(im.effective(), 'touch', '切回自动重新检测为触屏');
    // 写入不可用时不得抛异常，仍回退合法偏好。
    const im2 = new InputModeManager({ storage: throwingStorage, detectTouch: () => false });
    assert.equal(im2.setPreference('touch'), 'touch');
    assert.equal(im2.effective(), 'touch');
  }

  // —— 持久化读回：新会话恢复用户选择 ——
  {
    const storage = makeStorage();
    writeInputModePreference('keyboard', storage);
    const im = new InputModeManager({ storage, detectTouch: () => true });
    assert.equal(im.preference, 'keyboard', '新会话恢复强制键鼠');
    assert.equal(im.effective(), 'keyboard');
  }

  console.log('test-input-mode: OK');
})().catch((e) => { console.error(e); process.exit(1); });
