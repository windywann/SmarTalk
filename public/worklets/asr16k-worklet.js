// AudioWorklet processor: Downsample mic audio to 16kHz PCM16 and post chunks to main thread.

class Asr16kWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.ratio = sampleRate / this.targetRate;
    this.buf = new Float32Array(0);
    this.minInSamples = 4096;
  }

  appendToBuf(input) {
    const next = new Float32Array(this.buf.length + input.length);
    next.set(this.buf, 0);
    next.set(input, this.buf.length);
    this.buf = next;
  }

  resampleNearest(input) {
    const outLen = Math.floor(input.length / this.ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = Math.floor(i * this.ratio);
      const s = Math.max(-1, Math.min(1, input[idx] || 0));
      out[i] = s < 0 ? (s * 0x8000) : (s * 0x7fff);
    }
    return out;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    this.appendToBuf(input);

    if (this.buf.length >= this.minInSamples) {
      const pcm16 = this.resampleNearest(this.buf);
      this.port.postMessage(
        { type: 'pcm16', sampleRate: this.targetRate, buffer: pcm16.buffer },
        [pcm16.buffer]
      );
      this.buf = new Float32Array(0);
    }

    return true;
  }
}

registerProcessor('asr16k-processor', Asr16kWorkletProcessor);
