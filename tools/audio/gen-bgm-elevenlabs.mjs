#!/usr/bin/env node
/**
 * Offline BGM generator via ElevenLabs Music API. Never imported by the browser.
 * API: POST https://api.elevenlabs.io/v1/music  (xi-api-key)
 * Body: { prompt, duration_seconds } -> audio/mpeg
 * Replaces the MiniMax music-2.6 route (that endpoint is 410 for new keys).
 * Static MP3s are produced offline once and served as assets/audio/bgm/*.mp3;
 * the runtime never calls this API and never sees the key.
 *
 * Flags: --dry-run (no network), --only <slot>, --force (regenerate existing).
 * Retries 429/system_busy with exponential backoff; skips tracks already
 * present in the manifest so interrupted runs can resume safely.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'assets/audio/bgm');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const API = 'https://api.elevenlabs.io/v1/music';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// loopSeconds kept modest: starter music credits are limited; the BGM manager
// crossfades and the player loops, so 32-45s is enough for beta.
export const BGM_PROMPTS = Object.freeze({
  menu:    { seconds: 40, prompt: 'Seamless instrumental game menu loop, 72 BPM, welcoming open grassland prairie at sunrise, calm anticipation; soft plucked acoustic strings, airy flute, warm low pad. No vocals, no drums, consistent low loudness, begin and end on the same harmony so it loops forever with no seam.' },
  explore: { seconds: 45, prompt: 'Seamless instrumental gameplay loop, 92 BPM, light curious bright daytime steppe grassland; muted hand percussion, plucked strings, gentle woodwind, warm marimba. No vocals, consistent low loudness, loop-safe ending resolving to the opening harmony.' },
  tension: { seconds: 40, prompt: 'Seamless instrumental suspense loop, 82 BPM, watchful restrained tension as a fox approaches, never horror; soft low strings, sparse muted pulse, breathy flute harmonics. No vocals, no jump scare, low loudness, loop-safe.' },
  combat:  { seconds: 45, prompt: 'Seamless instrumental action loop, 112 BPM, focused energetic defensive action, brave but not aggressive; light frame drum, pizzicato strings, short orchestral accents, no brass stabs. No vocals, low loudness, loop-safe ending back to the start harmony.' },
  victory: { seconds: 32, prompt: 'Seamless instrumental success cue loop, 104 BPM, warm modest triumph, companions safe at home on the prairie; gentle strings, soft bells, plucked acoustic notes. No vocals, low loudness, resolves to its opening harmony for seamless looping.' },
  defeat:  { seconds: 32, prompt: 'Seamless instrumental gentle reset loop, 68 BPM, calm encouraging retry mood, not sad or tragic; soft piano-like keys, warm low strings, quiet woodwind. No vocals, low loudness, loop-safe.' },
});

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function writeManifest(assets) {
  return writeFile(MANIFEST_PATH, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), assets }, null, 2)}\n`);
}

// Accurate duration via ffprobe (the MP3 heuristic parser misses some encoder headers).
function ffprobeSeconds(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' }).trim();
    const v = Number.parseFloat(out);
    return Number.isFinite(v) ? Number(v.toFixed(3)) : null;
  } catch { return null; }
}

// Retry on 429 / system_busy with exponential backoff (starter tier is throttled).
async function fetchMusic(key, body, slot) {
  const waits = [20000, 40000, 60000, 90000, 120000];
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    const retryable = res.status === 429 || /rate_limit|system_busy|overloaded|timeout/i.test(text);
    if (!retryable || attempt === waits.length) {
      throw new Error(`ElevenLabs music ${slot} failed: HTTP ${res.status} ${text}`);
    }
    console.log(`  ${slot} HTTP ${res.status} busy, wait ${waits[attempt] / 1000}s (${attempt + 1}/${waits.length})...`);
    await sleep(waits[attempt]);
  }
  throw new Error(`ElevenLabs music ${slot} failed: unreachable`);
}

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { console.log('ELEVENLABS_API_KEY 未设置；跳过 BGM 生成。'); return; }
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const onlyIdx = args.indexOf('--only');
  const onlyName = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  await mkdir(OUT_DIR, { recursive: true });
  let assets = {};
  try { assets = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')).assets || {}; } catch { /* initial */ }
  const plans = Object.entries(BGM_PROMPTS)
    .filter(([slot]) => !onlyName || slot === onlyName)
    .map(([slot, spec]) => ({ slot, file: `assets/audio/bgm/${slot}.mp3`, body: { prompt: spec.prompt, duration_seconds: spec.seconds } }));
  if (dryRun) {
    for (const p of plans) console.log(`DRY RUN ${p.slot}: ${p.file} (${p.body.duration_seconds}s)`);
    console.log(`Validated ${plans.length} BGM prompts; no network request sent.`);
    return;
  }
  for (const plan of plans) {
    const filePath = path.join(ROOT, plan.file);
    const exists = assets[plan.slot]?.sha256 && await readFile(filePath).then(() => true).catch(() => false);
    if (!force && exists) { console.log(`Skip ${plan.slot} (already generated; --force to redo)`); continue; }
    console.log(`Generating BGM ${plan.slot} (${plan.body.duration_seconds}s)...`);
    const response = await fetchMusic(key, plan.body, plan.slot);
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, bytes);
    assets[plan.slot] = { file: plan.file, durationSeconds: ffprobeSeconds(filePath), sha256: sha256(bytes) };
    await writeManifest(assets);
    console.log(`Wrote ${plan.file} (${bytes.length} bytes)`);
    await sleep(6000); // gentle pacing to avoid 429
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`BGM generation stopped: ${error.message}`); process.exitCode = 1; });
}
