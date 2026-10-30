#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const api = await import('../src/sandbox/smartfox-blackbox.mjs');
  const args = process.argv.slice(2); const synthetic = args.includes('--synthetic');
  const outDir = path.resolve(args[args.indexOf('--out') + 1] || 'outputs/m3d-20261030-beta-smartfox-blackbox'); fs.mkdirSync(outDir, { recursive: true });
  const pkg = synthetic ? makeSynthetic(api) : JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const analysis = api.analyzeBlackBox(pkg);
  fs.writeFileSync(path.join(outDir, 'logic-trace.json'), JSON.stringify(analysis.logicTrace, null, 2));
  fs.writeFileSync(path.join(outDir, 'event-timeline.json'), JSON.stringify(analysis.eventTimeline, null, 2));
  fs.writeFileSync(path.join(outDir, 'anomalies.json'), JSON.stringify({ synthetic, anomalies: analysis.anomalies }, null, 2));
  const sheet = renderSheet(pkg, analysis);
  fs.writeFileSync(path.join(outDir, 'contact-sheet.svg'), sheet);
  for (const name of ['keyframe-000.svg', 'keyframe-001.svg', 'keyframe-002.svg']) fs.writeFileSync(path.join(outDir, name), sheet);
  console.log(JSON.stringify({ outDir, synthetic, anomalies: analysis.anomalies.length, contactSheet: path.join(outDir, 'contact-sheet.svg'), keyframes: ['keyframe-000.svg', 'keyframe-001.svg', 'keyframe-002.svg'].map((x) => path.join(outDir, x)) }, null, 2));
  function makeSynthetic() { return { format: api.SMARTFOX_BLACKBOX_FORMAT, version: 1, caseId: 'synthetic-fixture', build: { stamp: 'rev56' }, rngSeed: 7, foxTrajectories: Array.from({ length: 16 }, (_, i) => ({ t: i * .5, fox: { id: 'F1', x: 1 + (i % 2) * .01, z: 1, yaw: i % 2 ? .5 : -.5 } })), aiDecisions: Array.from({ length: 5 }, (_, i) => ({ t: i, decision: { targetId: 'player', yaw: i % 2 ? 1 : -1 } })), eventLog: [{ t: 1, type: 'smart-pounce-commit', distance: 1.1, lockAngleError: .8 }, { t: 2, type: 'smart-pounce-commit', distance: 1.2, lockAngleError: .7 }] }; }
  function renderSheet(p, a) { const rows = (p.foxTrajectories || []).slice(-120); const w = 900, h = 520, xs = rows.map((r) => Number(r.fox?.x) || 0), zs = rows.map((r) => Number(r.fox?.z) || 0); const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1), minZ = Math.min(...zs, 0), maxZ = Math.max(...zs, 1); const pts = rows.map((r) => { const x = 40 + ((Number(r.fox?.x) - minX) / Math.max(1e-6, maxX - minX)) * 820; const y = 430 - ((Number(r.fox?.z) - minZ) / Math.max(1e-6, maxZ - minZ)) * 360; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#b94b3d" opacity=".72"/>`; }).join(''); return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#f5f0e7"/><text x="40" y="30" font-family="sans-serif" font-size="20" fill="#2d2a25">SmartFox keyframe contact sheet${a.synthetic ? ' · SYNTHETIC FIXTURE' : ''}</text><text x="40" y="54" font-family="sans-serif" font-size="12" fill="#675f54">Red dots are recorded fox keyframes; anomalies: ${a.anomalies.length}</text><line x1="40" y1="430" x2="860" y2="430" stroke="#8a8175"/><line x1="40" y1="70" x2="40" y2="430" stroke="#8a8175"/>${pts}</svg>`; }
})();
