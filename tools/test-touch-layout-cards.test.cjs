const test = require('node:test');
const assert = require('node:assert/strict');

(async () => {
  const { normalizeCardEntries, clampCardCenter } = await import('../src/ui/touch-layout.js');
  const ids = ['hudVitals', 'hudMission', 'hudObjective', 'hudSandbox', 'hudMinimap'];
  const defaults = Object.fromEntries(ids.map((id, index) => [id, {
    x: 0.15 + index * 0.1, y: 0.2 + index * 0.08, scale: 1, opacity: 1,
  }]));

  test('旧 cards 存档缺 hudMinimap 时补默认并保留旧卡位置', () => {
    const oldCards = {
      hudVitals: { x: 0.31, y: 0.14, scale: 1.1, opacity: 0.8 },
      hudMission: { x: 0.52, y: 0.12, scale: 1, opacity: 1 },
      hudObjective: { x: 0.74, y: 0.8, scale: 0.9, opacity: 0.7 },
      hudSandbox: { x: 0.83, y: 0.42, scale: 1.2, opacity: 1 },
    };
    const normalized = normalizeCardEntries(oldCards, defaults, ids);
    assert.deepEqual(normalized.hudMinimap, defaults.hudMinimap);
    assert.deepEqual(normalized.hudVitals, oldCards.hudVitals);
    assert.deepEqual(normalized.hudObjective, oldCards.hudObjective);
  });

  test('小地图中心坐标按渲染尺寸夹紧到 safe area', () => {
    const safe = { left: 20, right: 28, top: 30, bottom: 34 };
    const viewport = { w: 390, h: 844 };
    const renderedScale = 1.12;
    const baseMap = { width: 142, height: 160 };
    const result = clampCardCenter(
      -100, 2000, 1, safe, viewport.w, viewport.h,
      { width: baseMap.width * renderedScale, height: baseMap.height * renderedScale }, renderedScale,
    );
    const normalized = { x: result.x / viewport.w, y: result.y / viewport.h };
    assert.ok(result.x >= safe.left + baseMap.width / 2 + 4);
    assert.ok(result.x <= viewport.w - safe.right - baseMap.width / 2 - 4);
    assert.ok(result.y >= safe.top + baseMap.height / 2 + 4);
    assert.ok(result.y <= viewport.h - safe.bottom - baseMap.height / 2 - 4);
    assert.ok(normalized.x > 0 && normalized.x < 1);
    assert.ok(normalized.y > 0 && normalized.y < 1);
  });
})();
