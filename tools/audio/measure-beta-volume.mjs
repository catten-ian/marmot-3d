/** Offline PCM evidence only. No playback/browser. Requires ffmpeg and local MP3s.
 * node tools/audio/measure-beta-volume.mjs /path/to/paf.mp3 /path/to/hit.mp3
 * Sources: TOS_AUDIO_BASE + elevenlabs/{bgm/paf,sfx/hit}.mp3
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AUDIO_DEFAULTS, AUDIO_VOLUME_MAX, AUDIO_COMPRESSOR, AUDIO_LIMITER_THRESHOLD_DB, BETA_MASTER_REFERENCE_GAIN,
  BGM_REFERENCE_RMS, resolveBgmPlaybackGain, audioPeakGuard, SFX_LIMITS,
} from '../../src/systems/audio.js';

const [pafPath, hitPath] = process.argv.slice(2);
if (!pafPath || !hitPath) throw new Error('Usage: node tools/audio/measure-beta-volume.mjs <paf.mp3> <hit.mp3>');
const db = (linear) => 20 * Math.log10(linear);
function stats(bytes, gain = 1, guard = false) {
  let sum = 0, peak = 0;
  const samples = bytes.length / 4;
  for (let i = 0; i < bytes.length; i += 4) {
    let sample = bytes.readFloatLE(i) * gain;
    if (guard) sample = audioPeakGuard(sample);
    peak = Math.max(peak, Math.abs(sample)); sum += sample * sample;
  }
  const rms = Math.sqrt(sum / samples);
  return { samples, peak, peakDbfs: db(peak), rms, rmsDbfs: db(rms) };
}
function measure(file, trim, leafDefault) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { maxBuffer: 256 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  const oldGain = trim * 0.32 * leafDefault / 100;
  const newGain = trim * BETA_MASTER_REFERENCE_GAIN * leafDefault / 100;
  const maximumGain = trim * BETA_MASTER_REFERENCE_GAIN * (AUDIO_VOLUME_MAX / 100) ** 2;
  return {
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    source: stats(result.stdout),
    oldDefault: { gain: oldGain, ...stats(result.stdout, oldGain) },
    betaDefault: { gain: newGain, ...stats(result.stdout, newGain) },
    maximumBeforeProtection: { gain: maximumGain, ...stats(result.stdout, maximumGain) },
    maximumGuardOnlyWorstAttack: stats(result.stdout, maximumGain, true),
    defaultIncreaseDb: db(newGain / oldGain),
  };
}
const paf = measure(pafPath, resolveBgmPlaybackGain({ assetKey: 'paf' }), AUDIO_DEFAULTS.bgmVolume);
const hit = measure(hitPath, 1, AUDIO_DEFAULTS.sfxVolume);
const voices = Object.values(SFX_LIMITS).reduce((sum, { maxConcurrent }) => sum + maxConcurrent, 0);
const levels = [
  { name: 'old-default', master: 0.32, sfx: 1, bgm: 0.61 },
  { name: 'beta-default-and-legacy-100', master: 0.48, sfx: 1, bgm: 0.61 },
  { name: 'beta-maximum', master: 0.72, sfx: 1.5, bgm: 1.5 },
];
const overload = levels.map(({ name, master, sfx, bgm }) => {
  const coherentFullScalePeak = (voices * sfx + 0.42 * 1.88 * bgm) * master;
  const inputDb = db(coherentFullScalePeak);
  // Above the knee: static compression curve only, NOT a WebAudio render.
  const compressedDb = AUDIO_LIMITER_THRESHOLD_DB + (inputDb - AUDIO_LIMITER_THRESHOLD_DB) / AUDIO_COMPRESSOR.ratio;
  return { name, voices, coherentFullScalePeak, inputDb,
    protectionPresent: name !== 'old-default',
    compressorStaticEstimatePeak: name === 'old-default' ? null : 10 ** (compressedDb / 20),
    guardOnlyPeak: name === 'old-default' ? null : audioPeakGuard(coherentFullScalePeak),
  };
});
console.log(JSON.stringify({
  method: 'ffmpeg decoded interleaved float32 PCM; linear bus mapping + analytic guard. Compressor DSP NOT rendered. No listening test.',
  expectedReferenceRms: BGM_REFERENCE_RMS, referenceRmsDifference: paf.source.rms - BGM_REFERENCE_RMS,
  paf, hit, overload,
}, null, 2));
