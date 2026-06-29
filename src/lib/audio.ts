import lamejs from './lame.all.js';

export function pcmToWavBlob(base64Pcm: string | string[], sampleRate: number = 24000): Blob {
  const base64Array = Array.isArray(base64Pcm) ? base64Pcm : [base64Pcm];
  
  // Calculate total length and decode
  let totalLen = 0;
  const decodedChunks: Uint8Array[] = [];
  
  for (const b64 of base64Array) {
    const binaryString = atob(b64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    decodedChunks.push(bytes);
    totalLen += len;
  }

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = totalLen;
  
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data sequentially
  let offset = 44;
  const targetBuffer = new Uint8Array(buffer);
  for (const chunk of decodedChunks) {
    targetBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export function pcmToMp3Blob(base64Pcm: string | string[], sampleRate: number = 24000): Blob {
  const base64Array = Array.isArray(base64Pcm) ? base64Pcm : [base64Pcm];
  
  let totalLen = 0;
  const decodedChunks: Uint8Array[] = [];
  
  for (const b64 of base64Array) {
    const binaryString = atob(b64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    decodedChunks.push(bytes);
    totalLen += len;
  }

  const allBytes = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of decodedChunks) {
    allBytes.set(chunk, offset);
    offset += chunk.length;
  }

  const samples = new Int16Array(allBytes.buffer);

  // @ts-ignore
  const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
  const mp3Data: Int8Array[] = [];

  const sampleBlockSize = 1152;
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const sampleChunk = samples.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}
