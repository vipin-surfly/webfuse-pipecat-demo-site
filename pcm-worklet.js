// AudioWorklets for the Pipecat WebSocket POC. The wire protocol is raw PCM:
// Int16, mono, 16 kHz — the same sample rate the AudioContext runs at, so
// both worklets only convert between Float32 and Int16, nothing else.

class PCMSender extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0][0];
    if (!channel) return true;
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

class PCMReceiver extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0;
    this.available = 0;
    this.started = false; // wait for ~200 ms of audio before playing
    this.port.onmessage = (e) => {
      const i16 = new Int16Array(e.data);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      this.chunks.push(f32);
      this.available += f32.length;
    };
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!this.started) {
      if (this.available < 3200) {
        out.fill(0);
        return true;
      }
      this.started = true;
    }
    let n = 0;
    while (n < out.length && this.chunks.length) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.length - this.offset, out.length - n);
      out.set(chunk.subarray(this.offset, this.offset + take), n);
      this.offset += take;
      n += take;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    this.available -= n;
    if (n < out.length) out.fill(0, n); // underrun: brief silence
    return true;
  }
}

registerProcessor("pcm-sender", PCMSender);
registerProcessor("pcm-receiver", PCMReceiver);
