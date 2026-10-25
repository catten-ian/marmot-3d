'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

(async () => {
  const transfer = await import('../src/core/config-transfer.mjs');
  const keybinds = await import('../src/core/keybinds.js');
  const layout = await import('../src/ui/touch-layout.js');

  test('配置导入导出 JSON 往返保留键位/布局/音频/输入模式', () => {
    const payload = transfer.buildConfigExport({
      binds: {
        scheme: 'custom', controlMode: 'driving',
        custom: { forward: 'KeyI', attack: ['KeyJ', 'KeyK'], cameraView: 'KeyC' },
      },
      layout: {
        scale: 1, opacity: 0.8,
        buttons: { attack: { x: 0.5, y: 0.8, scale: 1.1, opacity: 0.9 } },
        cards: { hudMinimap: { x: 0.8, y: 0.2, scale: 1, opacity: 0.7 } },
        joystick: { x: 0.2, y: 0.8, scale: 1, sprintThreshold: 0.8 },
      },
      audioSettings: { masterVolume: 72, sfxVolume: 55, bgmVolume: 33, sfxEnabled: true, bgmEnabled: false },
      graphicsPreference: 'power-saving', inputModePreference: 'touch', inputModeEffective: 'touch',
      now: new Date('2026-10-24T12:34:00.000Z'),
    });
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.inputMode, 'touch');
    const result = transfer.parseConfigText(JSON.stringify(payload));
    assert.equal(result.ok, true);
    assert.equal(result.config.keybinds.custom.cameraView, 'KeyC');
    assert.deepEqual(result.config.audio, payload.audio);
    assert.equal(result.config.graphics, 'power-saving');
    assert.equal(result.config.inputModePreference, 'touch');
  });

  test('非法字段白名单忽略，数值越界钳制并产生提示', () => {
    const result = transfer.sanitizeConfig({
      schemaVersion: 1,
      unknownTop: true,
      keybinds: { scheme: 'not-a-scheme', custom: { forward: 'bad key!', nope: 'KeyX' } },
      touchLayout: {
        scale: 99,
        buttons: { attack: { x: 4, y: -1, unknown: 1 } },
        cards: { hudMinimap: { opacity: -3 }, nope: { x: 0.5 } },
      },
      audio: { masterVolume: 150, bgmVolume: 'NaN', madeUp: true },
      graphics: 'invalid',
    });
    assert.equal(result.ok, true);
    assert.equal(result.config.touchLayout.scale, 1.5);
    assert.equal(result.config.touchLayout.buttons.attack.x, 1);
    assert.equal(result.config.touchLayout.buttons.attack.y, 0);
    assert.equal(result.config.audio.masterVolume, 100);
    assert.equal(result.config.audio.bgmVolume, undefined);
    assert.ok(result.ignored.includes('unknownTop'));
    assert.ok(result.ignored.includes('keybinds.custom.nope'));
    assert.ok(result.ignored.includes('touchLayout.cards.nope'));
    assert.ok(result.warnings.length >= 3);
  });

  test('schemaVersion 错误拒绝，键位冲突检测保持原语义', () => {
    assert.equal(transfer.sanitizeConfig({ schemaVersion: 999, audio: {} }).ok, false);
    const conflicts = keybinds.findConflicts({ attack: 'KeyJ', burst: ['KeyJ', 'KeyQ'], jump: 'Space' });
    assert.deepEqual(conflicts.get('KeyJ'), ['attack', 'burst']);
  });

  test('CARDS 用原有视角按钮 hudViewBtn 取代重复状态卡 hudViewMode', () => {
    assert.ok(layout.CARDS.includes('hudMinimap'));
    assert.ok(layout.CARDS.includes('hudViewBtn'));
    assert.ok(!layout.CARDS.includes('hudViewMode'));
  });
})();
