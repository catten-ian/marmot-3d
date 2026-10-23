#!/usr/bin/env node
/**
 * Offline asset generator. This module is never imported by the browser/runtime.
 * API: POST https://api.minimax.io/v1/music_generation (Bearer key)
 * model=music-2.6, output_format=hex, audio_setting.format=mp3; save data.audio hex.
 * Docs: https://platform.minimax.io/docs/api-reference/music-generation
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mp3DurationSeconds } from './gen-sfx-elevenlabs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'assets/audio/bgm');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const API = 'https://api.minimax.io/v1/music_generation';
const MODEL = 'music-2.6';

// Background score prompts; generation is a manual/offline operation only.
export const BGM_PROMPTS = Object.freeze({
  menu: { bpm: 72, mood: 'welcoming, open prairie at sunrise, calm anticipation', instruments: 'soft plucked acoustic strings, airy flute, warm low pad', seconds: 40 },
  explore: { bpm: 92, mood: 'light, curious, bright grassland daytime', instruments: 'muted hand percussion, plucked strings, gentle woodwind, warm marimba accents', seconds: 45 },
  tension: { bpm: 82, mood: 'watchful, restrained suspense as a fox approaches, never horror', instruments: 'soft low strings, sparse muted pulse, breathy flute harmonics', seconds: 40 },
  combat: { bpm: 112, mood: 'focused, energetic defensive action, brave but not aggressive', instruments: 'light frame drum, pizzicato strings, short brass-free orchestral accents', seconds: 45 },
  victory: { bpm: 104, mood: 'warm success, companions safe at home, uplifting but modest', instruments: 'gentle strings, soft bells, plucked acoustic notes', seconds: 32 },
  defeat: { bpm: 68, mood: 'gentle reset and encouragement to try again, not tragic', instruments: 'soft piano-like keys, warm low strings, quiet woodwind', seconds: 32 },
});

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function writeManifest(assets) {
  return writeFile(MANIFEST_PATH, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), assets }, null, 2)}\n`);
}

async function main() {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) {
    console.log('MINIMAX_API_KEY 未设置；跳过背景音乐生成。');
    return;
  }
  const dryRun = process.argv.slice(2).includes('--dry-run');
  await mkdir(OUT_DIR, { recursive: true });
  let assets = {};
  try { assets = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')).assets || {}; } catch (_) { /* initial empty manifest */ }
  const plans = Object.entries(BGM_PROMPTS).map(([slot, spec]) => ({
    slot,
    file: `assets/audio/bgm/${slot}.mp3`,
    body: {
      model: MODEL,
      prompt: `Instrumental seamless loop for a game, ${spec.bpm} BPM, ${spec.mood}; ${spec.instruments}. Create a loop-safe ${spec.seconds}-second arrangement: no vocals, no sudden ending, resolve naturally to its opening harmony, consistent low loudness.`,
      is_instrumental: true,
      output_format: 'hex',
      audio_setting: { sample_rate: 44100, bitrate: 128000, format: 'mp3' },
    },
    targetSeconds: spec.seconds,
  }));
  if (dryRun) {
    for (const plan of plans) console.log(`DRY RUN ${plan.slot}: ${plan.file} (${plan.targetSeconds}s, ${plan.body.model})`);
    console.log(`Validated ${plans.length} BGM prompts; no network request sent.`);
    return;
  }

  for (const plan of plans) {
    console.log(`Generating ${plan.slot}...`);
    const response = await fetch(API, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(plan.body),
    });
    if (!response.ok) throw new Error(`MiniMax ${plan.slot} failed: HTTP ${response.status} ${await response.text()}`);
    const payload = await response.json();
    if (payload?.base_resp?.status_code && payload.base_resp.status_code !== 0) {
      throw new Error(`MiniMax ${plan.slot} failed: ${payload.base_resp.status_msg || payload.base_resp.status_code}`);
    }
    const hex = payload?.data?.audio;
    if (typeof hex !== 'string' || !/^(?:[\da-f]{2})+$/i.test(hex)) throw new Error(`MiniMax ${plan.slot} response did not contain hex MP3 data.`);
    const bytes = Buffer.from(hex, 'hex');
    const filePath = path.join(ROOT, plan.file);
    await writeFile(filePath, bytes);
    assets[plan.slot] = { file: plan.file, durationSeconds: mp3DurationSeconds(bytes), sha256: sha256(bytes) };
    await writeManifest(assets);
    console.log(`Wrote ${plan.file} (${bytes.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(`BGM generation stopped: ${error.message}`);
  process.exitCode = 1;
});
