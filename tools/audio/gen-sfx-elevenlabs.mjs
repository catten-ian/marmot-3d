#!/usr/bin/env node
/**
 * Offline asset generator. It is never imported by the browser/runtime.
 * API: POST https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128
 * Auth: xi-api-key header. JSON body: model_id, text, duration_seconds, prompt_influence.
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'assets/audio/sfx');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const API = 'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128';
const MODEL_ID = 'eleven_text_to_sound_v2';
const PROMPT_INFLUENCE = 0.72;

// Keep all prompts here so the SFX direction stays coherent and easy to review.
export const SFX_PROMPTS = Object.freeze({
  swing: { prompt: 'A quick soft paw swipe through dry steppe grass, friendly stylized marmot game foley, crisp airy swish, no voice, no music.', seconds: 0.7 },
  hit: { prompt: 'A compact cartoony but weighty padded impact with a tiny dusty thump, animal paw striking a soft target, no pain vocalization, no music.', seconds: 0.8 },
  repel: { prompt: 'A playful successful defensive shove followed by quick retreating paws on dry grass, clear upward whoosh and scurry away, not a kill sound, no voice, no music.', seconds: 1.2 },
  berry: { prompt: 'A small juicy berry pickup with two bright gentle woodland chimes, warm and charming but not childish, no voice, no music.', seconds: 0.8 },
  burst: { prompt: 'A short emergency power burst: soft rising energy rush, rounded low thump and airy sparkle, stylized wildlife adventure game, no voice, no music.', seconds: 1.1 },
  ultimate: { prompt: 'A coordinated special move: broad warm rising pulse, layered airy sweep and restrained impact, triumphant steppe adventure game, no voice, no music.', seconds: 1.4 },
  hurt: { prompt: 'A brief low soft impact cue indicating a hit, restrained and non-graphic, rounded thud with muted airy tail, no cry, no voice, no music.', seconds: 0.9 },
  foxWind: { prompt: 'A fox preparing to pounce: short tense rising breath-like wind whistle with dry grass rustle, alert but not frightening, no animal voice, no music.', seconds: 1.0 },
  jump: { prompt: 'A tiny marmot hop: light upward springy whoop made only of soft wind and a small paw tap, no voice, no music.', seconds: 0.7 },
  foxDash: { prompt: 'A fast fox pounce pass-by through dry steppe grass, sharp airy rush and paw scuff, brief and readable, no growl, no voice, no music.', seconds: 0.9 },
  rescue: { prompt: 'A warm three-note rescue success chime, gentle acoustic sparkle, reassuring steppe adventure game, no voice, no music.', seconds: 1.2 },
  helpCry: { prompt: 'Two short distant friendly marmot-like calls rendered as soft nonverbal whistles, clear and gentle, not realistic distress, no words, no music.', seconds: 1.0 },
  levelUp: { prompt: 'A four-note uplifting level completion flourish, warm and modest, soft bells and clear decay, no voice, no music.', seconds: 1.7 },
  win: { prompt: 'A five-note joyful finale flourish for a family-friendly wildlife adventure, bright but restrained bells, no voice, no music.', seconds: 2.4 },
  lose: { prompt: 'A short gentle descending four-note retry cue, calm and encouraging rather than sad, soft rounded tones, no voice, no music.', seconds: 2.3 },
  lowHealth: { prompt: 'One subtle low rounded warning ping with a short soft tail, readable but not alarming, no voice, no music.', seconds: 0.7 },
});

export function mp3DurationSeconds(bytes) {
  const data = Buffer.from(bytes);
  let offset = 0;
  if (data.toString('ascii', 0, 3) === 'ID3' && data.length >= 10) {
    const size = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
    offset = 10 + size;
  }
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  let duration = 0;
  for (let i = offset; i + 4 <= data.length;) {
    const h = data.readUInt32BE(i);
    if ((h & 0xffe00000) !== 0xffe00000) { i++; continue; }
    const version = (h >>> 19) & 3;
    const layer = (h >>> 17) & 3;
    const bitrateIndex = (h >>> 12) & 0xf;
    const sampleIndex = (h >>> 10) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) { i++; continue; }
    const kbps = bitrates[bitrateIndex];
    const baseRate = [44100, 48000, 32000][sampleIndex];
    const sampleRate = version === 3 ? baseRate : version === 2 ? baseRate / 2 : baseRate / 4;
    const samples = version === 3 ? 1152 : 576;
    const frameLength = Math.floor((version === 3 ? 144 : 72) * kbps * 1000 / sampleRate) + ((h >>> 9) & 1);
    if (frameLength < 4 || i + frameLength > data.length) { i++; continue; }
    duration += samples / sampleRate;
    i += frameLength;
  }
  return duration ? Number(duration.toFixed(3)) : null;
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function writeManifest(assets) {
  return writeFile(MANIFEST_PATH, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), assets }, null, 2)}\n`);
}

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.log('ELEVENLABS_API_KEY 未设置；跳过音效生成。');
    return;
  }
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  await mkdir(OUT_DIR, { recursive: true });
  let assets = {};
  try { assets = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')).assets || {}; } catch (_) { /* initial empty manifest */ }
  const plans = Object.entries(SFX_PROMPTS).map(([name, spec]) => ({
    name,
    file: `assets/audio/sfx/${name}.mp3`,
    body: { model_id: MODEL_ID, text: spec.prompt, duration_seconds: spec.seconds, prompt_influence: PROMPT_INFLUENCE },
  }));
  if (dryRun) {
    for (const plan of plans) console.log(`DRY RUN ${plan.name}: ${plan.file} (${plan.body.duration_seconds}s, ${plan.body.model_id})`);
    console.log(`Validated ${plans.length} SFX prompts; no network request sent.`);
    return;
  }

  for (const plan of plans) {
    console.log(`Generating ${plan.name}...`);
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify(plan.body),
    });
    if (!response.ok) throw new Error(`ElevenLabs ${plan.name} failed: HTTP ${response.status} ${await response.text()}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(ROOT, plan.file);
    await writeFile(filePath, bytes);
    assets[plan.name] = { file: plan.file, durationSeconds: mp3DurationSeconds(bytes), sha256: sha256(bytes) };
    if (plan.name === 'repel') assets.kill = { ...assets.repel, aliasOf: 'repel' };
    await writeManifest(assets);
    console.log(`Wrote ${plan.file} (${bytes.length} bytes)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`SFX generation stopped: ${error.message}`);
    process.exitCode = 1;
  });
}
