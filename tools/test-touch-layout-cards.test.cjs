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

// —— HUD 卡 X/Y 百分比输入的纯函数（item 4）——
(async () => {
  const { normalizedToPercent, percentToNormalized } = await import('../src/ui/touch-layout.js');

  test('normalizedToPercent：0..1 → 0-100（1 位小数，clamp）', () => {
    assert.equal(normalizedToPercent(0), 0);
    assert.equal(normalizedToPercent(1), 100);
    assert.equal(normalizedToPercent(0.5), 50);
    assert.equal(normalizedToPercent(0.123456), 12.3);
    assert.equal(normalizedToPercent(-0.2), 0);
    assert.equal(normalizedToPercent(1.7), 100);
    assert.equal(normalizedToPercent(NaN), 0);
  });

  test('percentToNormalized：数字/带%字符串/越界/非法', () => {
    assert.equal(percentToNormalized(50), 0.5);
    assert.equal(percentToNormalized('25'), 0.25);
    assert.equal(percentToNormalized('87.5%'), 0.875);
    assert.equal(percentToNormalized(' -10 '), 0, '越界 clamp 到 0');
    assert.equal(percentToNormalized('250'), 1, '越界 clamp 到 1');
    assert.equal(percentToNormalized('abc'), null, '非法输入返回 null（保持原值）');
    assert.equal(percentToNormalized(''), null);
    assert.equal(percentToNormalized(NaN), null);
    const r = percentToNormalized('33.3');
    assert.ok(r > 0 && r < 1 && Number.isFinite(r), '结果必须是有限数，绝不 NaN');
  });

  test('百分比 ↔ 归一化往返一致', () => {
    for (const v of [0, 0.05, 0.5, 0.876, 1]) {
      assert.equal(percentToNormalized(normalizedToPercent(v)), Math.round(v * 1000) / 1000);
    }
  });
})();
