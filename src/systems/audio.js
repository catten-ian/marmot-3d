/**
 * 程序化音效：全部用 WebAudio 振荡器/噪声合成，不依赖任何音频文件。
 * 保持项目"零外部资源、可离线运行"的特性。
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
      return true;
    } catch (e) {
      this.enabled = false;
      return false;
    }
  }

  setEnabled(v) {
    this.enabled = v;
    if (this.master) this.master.gain.value = v ? 0.32 : 0;
  }

  _noise() {
    if (!this._noiseBuf) {
      const len = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    return src;
  }

  _tone(freq, dur, type = 'sine', gain = 0.3, freqEnd = null, pan = 0) {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.015, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(panner); panner.connect(this.master);
    } else g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  _burstNoise(dur, gain = 0.25, filterFreq = 1200, type = 'lowpass', pan = 0) {
    if (!this.enabled || !this.ensure()) return;
    const t = this.ctx.currentTime;
    const src = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.3), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(panner); panner.connect(this.master);
    } else g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // —— 具体音效 ——
  swing() { this._burstNoise(0.11, 0.14, 2600, 'bandpass'); }
  hit() {
    this._tone(320, 0.09, 'square', 0.16, 140);
    this._burstNoise(0.08, 0.16, 1800);
  }
  /**
   * 驱退成功：不是"击杀音"（那会强化错误的语义），
   * 而是一声上扬的"驱赶"音 + 急促的逃窜脚步，表达"它跑了"。
   */
  repel() {
    this._tone(520, 0.1, 'triangle', 0.16, 760);
    this._burstNoise(0.12, 0.1, 1600, 'bandpass');
    // 逃窜的爪子声
    setTimeout(() => this._burstNoise(0.2, 0.09, 1100, 'bandpass'), 90);
  }
  /** @deprecated 旧命名，保留以防其他引用；语义已改为驱退 */
  kill() { this.repel(); }
  berry() {
    this._tone(660, 0.09, 'sine', 0.2);
    setTimeout(() => this._tone(880, 0.12, 'sine', 0.18), 70);
  }
  burst() {
    this._tone(240, 0.34, 'sawtooth', 0.24, 620);
    this._burstNoise(0.3, 0.2, 2200);
  }
  ultimate() {
    this._tone(160, 0.6, 'sawtooth', 0.3, 90);
    this._tone(420, 0.5, 'triangle', 0.2, 140);
    this._burstNoise(0.55, 0.26, 3000, 'bandpass');
  }
  hurt() {
    this._tone(150, 0.2, 'square', 0.22, 70);
    this._burstNoise(0.14, 0.18, 600);
  }
  foxWind() { this._tone(520, 0.4, 'triangle', 0.08, 900); }
  jump() {
    // 短促的上扬轻响，符合小型挖掘动物蹦跳的感觉
    this._tone(340, 0.11, 'sine', 0.12, 620);
    this._burstNoise(0.06, 0.05, 800);
  }
  foxDash() { this._burstNoise(0.22, 0.16, 1400, 'bandpass'); }
  /** Caution 1.0-1.2k pure tones; urgent 1.4-1.9k triple tones, distinct from foxDash noise. */
  companionAlarm(level, pan = 0) {
    const notes = level === 'urgent' ? [1397, 1661, 1865] : level === 'caution' ? [1046, 1175] : [];
    const duration = level === 'urgent' ? 0.07 : 0.09, gain = level === 'urgent' ? 0.15 : 0.12, gap = level === 'urgent' ? 0.14 : 0.18;
    notes.forEach((freq, i) => setTimeout(() => this._tone(freq, duration, level === 'urgent' ? 'sine' : 'triangle', gain, null, pan), i * gap * 1000));
  }
  rescue() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 'sine', 0.18), i * 90));
  }
  /** 伙伴呼救：两声上扬的短促叫声。attenuation 越大（距离越远）音量越低 */
  helpCry(attenuation = 0.5) {
    if (!this.enabled || !this.ensure()) return;
    const vol = 0.16 * (1 - Math.min(0.85, attenuation));
    this._tone(760, 0.09, 'triangle', vol, 980);
    setTimeout(() => this._tone(980, 0.1, 'triangle', vol * 0.85, 1180), 95);
  }
  levelUp() {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.28, 'triangle', 0.22), i * 130));
  }
  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this._tone(f, 0.4, 'sine', 0.24), i * 160));
  }
  lose() {
    [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this._tone(f, 0.42, 'sine', 0.22), i * 190));
  }
  lowHealth() { this._tone(220, 0.16, 'sine', 0.14, 180); }
}
