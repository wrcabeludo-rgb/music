// AudioWorklet: меняет высоту тона без изменения темпа (SoundTouch, WSOLA).
// Темп меняется скоростью воспроизведения дорожек, а сдвиг тона, который при
// этом появляется, здесь компенсируется.
import { SoundTouch } from './vendor/soundtouch/soundtouch.js?v=1';

const BLOCK = 128;
const PREFILL = 3072; // запас на выходе (~70 мс), чтобы не было щелчков

class PitchProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.st = new SoundTouch();
    this.st.stretch.setParameters(sampleRate, 0, 0, 8);
    const pitch = options?.processorOptions?.pitch;
    if (pitch) this.st.pitch = pitch;
    this.inter = new Float32Array(BLOCK * 2);
    this.out = new Float32Array(BLOCK * 2);
    this.ready = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.pitch) this.st.pitch = m.pitch;
      if (m.clear) { this.st.clear(); this.st.inputBuffer.clear(); this.st.outputBuffer.clear(); this.ready = false; }
    };
  }

  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    const n = out[0].length;
    const l = inp[0], r = inp[1] || inp[0];
    for (let i = 0; i < n; i++) {
      this.inter[2 * i] = l ? l[i] : 0;
      this.inter[2 * i + 1] = r ? r[i] : 0;
    }
    this.st.inputBuffer.putSamples(this.inter, 0, n);
    this.st.process();

    const ob = this.st.outputBuffer;
    if (!this.ready && ob.frameCount >= PREFILL) this.ready = true;
    if (this.ready && ob.frameCount >= n) {
      ob.receiveSamples(this.out, n);
      for (let i = 0; i < n; i++) {
        out[0][i] = this.out[2 * i];
        if (out[1]) out[1][i] = this.out[2 * i + 1];
      }
      // Не даем задержке расти, если вход и выход немного разошлись.
      if (ob.frameCount > PREFILL * 3) ob.receive(ob.frameCount - PREFILL);
    } else {
      this.ready = false;
      out[0].fill(0); if (out[1]) out[1].fill(0);
    }
    return true;
  }
}

registerProcessor('pitch-shift', PitchProcessor);
