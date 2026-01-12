// AudioWorklet processor: downsample mic audio to 16kHz PCM16 and post chunks to main thread.
// Notes:
// - This is a pragmatic implementation for speech recognition streaming (not hi-fi resampling).
// - We accumulate input samples and resample in batches to reduce postMessage overhead.

class Asr16kWorkletProcessor extends AudioWorkletProcessor {
  private readonly targetRate = 16000;
  private readonly inputRate = sampleRate;
  private readonly ratio = this.inputRate / this.targetRate;
  private buf: Float32Array = new Float32Array(0);
  private minInSamples = 4096;

  private appendToBuf(input: Float32Array) {
    const next = new Float32Array(this.buf.length + input.length);
    next.set(this.buf, 0);
    next.set(input, this.buf.length);
    this.buf = next;
  }

  private resampleNearest(input: Float32Array) {
    // Linear-ish: nearest neighbor (fast) is acceptable for ASR streaming.
    const outLen = Math.floor(input.length / this.ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = Math.floor(i * this.ratio);
      const s = Math.max(-1, Math.min(1, input[idx] ?? 0));
      out[i] = s < 0 ? (s * 0x8000) : (s * 0x7fff);
    }
    return out;
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0); // silence output

    if (!input) return true;

    this.appendToBuf(input);

    if (this.buf.length >= this.minInSamples) {
      const pcm16 = this.resampleNearest(this.buf);
      // Transfer ArrayBuffer to avoid copying
      this.port.postMessage(
        { type: 'pcm16', sampleRate: this.targetRate, buffer: pcm16.buffer },
        [pcm16.buffer],
      );
      this.buf = new Float32Array(0);
    }

    return true;
  }
}

registerProcessor('asr16k-worklet', Asr16kWorkletProcessor);


