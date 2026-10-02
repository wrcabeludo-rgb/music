/**
 * Demucs audio processor - Core separation logic
 */

import { CONSTANTS } from './constants.js';
import { stft, istft, reflectPad } from './fft.js';

const { SAMPLE_RATE, FFT_SIZE, HOP_SIZE, TRAINING_SAMPLES, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES, SEGMENT_OVERLAP, TRACKS } = CONSTANTS;

/**
 * Convert model frequency output to complex spectrogram per track
 */
export function standaloneMask(freqOutput) {
  const numTracks = 4;
  const numChannels = 4;
  const numBins = MODEL_SPEC_BINS;
  const numFrames = MODEL_SPEC_FRAMES;
  const result = [];

  for (let t = 0; t < numTracks; t++) {
    const trackSpec = {
      leftReal: new Float32Array(numBins * numFrames),
      leftImag: new Float32Array(numBins * numFrames),
      rightReal: new Float32Array(numBins * numFrames),
      rightImag: new Float32Array(numBins * numFrames)
    };

    for (let f = 0; f < numFrames; f++) {
      for (let b = 0; b < numBins; b++) {
        const baseIdx = t * numChannels * numBins * numFrames;
        const outIdx = b * numFrames + f;
        trackSpec.leftReal[outIdx] = freqOutput[baseIdx + 0 * numBins * numFrames + b * numFrames + f];
        trackSpec.leftImag[outIdx] = freqOutput[baseIdx + 1 * numBins * numFrames + b * numFrames + f];
        trackSpec.rightReal[outIdx] = freqOutput[baseIdx + 2 * numBins * numFrames + b * numFrames + f];
        trackSpec.rightImag[outIdx] = freqOutput[baseIdx + 3 * numBins * numFrames + b * numFrames + f];
      }
    }
    result.push(trackSpec);
  }

  return result;
}

/**
 * Convert complex spectrogram back to time domain (iSTFT with proper offsets)
 */
export function standaloneIspec(trackSpec, targetLength) {
  const numBins = MODEL_SPEC_BINS;
  const numFrames = MODEL_SPEC_FRAMES;
  const hopLength = HOP_SIZE;
  const paddedBins = numBins + 1;
  const paddedFrames = numFrames + 4;

  const padChannel = (real, imag) => {
    const paddedReal = new Float32Array(paddedFrames * paddedBins);
    const paddedImag = new Float32Array(paddedFrames * paddedBins);

    for (let f = 0; f < numFrames; f++) {
      for (let b = 0; b < numBins; b++) {
        const srcIdx = b * numFrames + f;
        const dstFrame = f + 2;
        const dstIdx = dstFrame * paddedBins + b;
        paddedReal[dstIdx] = real[srcIdx];
        paddedImag[dstIdx] = imag[srcIdx];
      }
    }
    return { real: paddedReal, imag: paddedImag };
  };

  const leftPadded = padChannel(trackSpec.leftReal, trackSpec.leftImag);
  const rightPadded = padChannel(trackSpec.rightReal, trackSpec.rightImag);

  const centerPad = FFT_SIZE / 2;
  const pad = Math.floor(hopLength / 2) * 3;
  const istftLength = (paddedFrames - 1) * hopLength + FFT_SIZE;

  const leftOut = istft(leftPadded.real, leftPadded.imag, paddedFrames, paddedBins, FFT_SIZE, hopLength, istftLength);
  const rightOut = istft(rightPadded.real, rightPadded.imag, paddedFrames, paddedBins, FFT_SIZE, hopLength, istftLength);

  const totalOffset = centerPad + pad;
  const left = leftOut.subarray(totalOffset, totalOffset + targetLength);
  const right = rightOut.subarray(totalOffset, totalOffset + targetLength);

  return { left: new Float32Array(left), right: new Float32Array(right) };
}

/**
 * Prepare model input from stereo audio
 */
export function prepareModelInput(leftChannel, rightChannel) {
  const inputLength = TRAINING_SAMPLES;

  const paddedLeft = new Float32Array(inputLength);
  const paddedRight = new Float32Array(inputLength);
  const copyLen = Math.min(leftChannel.length, inputLength);
  paddedLeft.set(leftChannel.subarray(0, copyLen));
  paddedRight.set(rightChannel.subarray(0, copyLen));

  const le = Math.ceil(inputLength / HOP_SIZE);
  const pad = Math.floor(HOP_SIZE / 2) * 3;
  const padRight = pad + le * HOP_SIZE - inputLength;

  const stftInputLeft = reflectPad(paddedLeft, pad, padRight);
  const stftInputRight = reflectPad(paddedRight, pad, padRight);

  const centerPad = FFT_SIZE / 2;
  const centeredLeft = reflectPad(stftInputLeft, centerPad, centerPad);
  const centeredRight = reflectPad(stftInputRight, centerPad, centerPad);

  const stftLeft = stft(centeredLeft, FFT_SIZE, HOP_SIZE);
  const stftRight = stft(centeredRight, FFT_SIZE, HOP_SIZE);

  const numBins = MODEL_SPEC_BINS;
  const numFrames = MODEL_SPEC_FRAMES;
  const frameOffset = 2;

  const magSpec = new Float32Array(4 * numBins * numFrames);

  for (let f = 0; f < numFrames; f++) {
    const srcFrame = f + frameOffset;
    for (let b = 0; b < numBins; b++) {
      const srcIdx = srcFrame * stftLeft.numBins + b;
      magSpec[0 * numBins * numFrames + b * numFrames + f] = stftLeft.real[srcIdx];
      magSpec[1 * numBins * numFrames + b * numFrames + f] = stftLeft.imag[srcIdx];
      magSpec[2 * numBins * numFrames + b * numFrames + f] = stftRight.real[srcIdx];
      magSpec[3 * numBins * numFrames + b * numFrames + f] = stftRight.imag[srcIdx];
    }
  }

  const waveform = new Float32Array(2 * inputLength);
  waveform.set(paddedLeft, 0);
  waveform.set(paddedRight, inputLength);

  return { waveform, magSpec, numBins, numFrames, originalLength: leftChannel.length };
}

/**
 * Main Demucs processor class
 */
export class DemucsProcessor {
  constructor(options = {}) {
    this.ort = options.ort || null;
    this.session = null;
    this.modelPath = options.modelPath || './htdemucs_embedded.onnx';
    this.sessionOptions = options.sessionOptions || {};
    this.onProgress = options.onProgress || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onDownloadProgress = options.onDownloadProgress || (() => {});
  }

  async loadModel(modelPathOrBuffer) {
    if (!this.ort) {
      throw new Error('ONNX Runtime not provided. Pass ort in constructor options.');
    }

    this.onLog('model', 'Loading model...');

    let modelBuffer;
    if (modelPathOrBuffer instanceof ArrayBuffer) {
      modelBuffer = modelPathOrBuffer;
    } else {
      const response = await fetch(modelPathOrBuffer || this.modelPath);

      // Check if we can track progress
      const contentLength = response.headers.get('Content-Length');
      if (contentLength && response.body) {
        const totalSize = parseInt(contentLength, 10);
        const reader = response.body.getReader();
        const chunks = [];
        let loadedSize = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loadedSize += value.length;
          this.onDownloadProgress(loadedSize, totalSize);
        }

        // Combine chunks into single ArrayBuffer
        const combined = new Uint8Array(loadedSize);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        modelBuffer = combined.buffer;
      } else {
        // Fallback: no progress tracking
        modelBuffer = await response.arrayBuffer();
      }
    }

    const defaultSessionOptions = {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'basic'
    };

    this.session = await this.ort.InferenceSession.create(modelBuffer, {
      ...defaultSessionOptions,
      ...this.sessionOptions
    });

    this.onLog('model', 'Model loaded successfully');
    return this.session;
  }

  /**
   * Run the model on one segment of TRAINING_SAMPLES samples.
   * Returns per-track { left, right } Float32Arrays (track order as in TRACKS).
   */
  async _inferSegment(segLeft, segRight) {
    const input = prepareModelInput(segLeft, segRight);

    const feeds = {};
    feeds[this.session.inputNames[0]] = new this.ort.Tensor('float32', input.waveform, [1, 2, TRAINING_SAMPLES]);
    if (this.session.inputNames.length > 1) {
      feeds[this.session.inputNames[1]] = new this.ort.Tensor('float32', input.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]);
    }

    const inferResults = await this.session.run(feeds);

    let timeTensor = null, freqTensor = null;
    for (const name of this.session.outputNames) {
      const tensor = inferResults[name];
      if (tensor.dims.length === 4 && tensor.dims[2] === 2) timeTensor = tensor;
      else if (tensor.dims.length === 5 && tensor.dims[2] === 4) freqTensor = tensor;
      else tensor.dispose?.();
    }
    if (!timeTensor) throw new Error('Could not find time-domain output tensor');

    const timeData = timeTensor.data;
    const [, numTracks, numChannels, samples] = timeTensor.dims;
    const trackSpecs = freqTensor ? standaloneMask(freqTensor.data) : null;
    freqTensor?.dispose?.();

    const out = [];
    for (let t = 0; t < numTracks; t++) {
      const left = new Float32Array(samples);
      const right = new Float32Array(samples);
      left.set(timeData.subarray(t * numChannels * samples, t * numChannels * samples + samples));
      right.set(timeData.subarray((t * numChannels + 1) * samples, (t * numChannels + 1) * samples + samples));
      if (trackSpecs) {
        const freqOutput = standaloneIspec(trackSpecs[t], TRAINING_SAMPLES);
        trackSpecs[t] = null;
        for (let i = 0; i < samples; i++) {
          left[i] += freqOutput.left[i] || 0;
          right[i] += freqOutput.right[i] || 0;
        }
      }
      out.push({ left, right });
    }
    timeTensor.dispose?.();
    return out;
  }

  /**
   * Memory-lean separation: overlap-add happens in a window of one segment,
   * finished samples go straight to 16-bit PCM. Memory does not grow with
   * a float copy of every stem, which matters on phones.
   * Returns { drums, bass, other, vocals }: Int16Array(2 * n), left then right.
   * With onChunk(start, { drums, bass, ... }) finished pieces (Int16Array, left
   * then right within the piece) are handed out instead and nothing is kept.
   */
  async separateInt16(leftChannel, rightChannel, onChunk = null) {
    if (!this.session) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const totalSamples = leftChannel.length;
    const L = TRAINING_SAMPLES;
    const stride = Math.floor(L * (1 - SEGMENT_OVERLAP));
    const numSegments = Math.ceil((totalSamples - L) / stride) + 1;

    const pcm = onChunk ? null : TRACKS.map(() => new Int16Array(totalSamples * 2));
    const acc = TRACKS.map(() => ({ left: new Float32Array(L), right: new Float32Array(L) }));
    const weights = new Float32Array(L);
    const segLeft = new Float32Array(L);
    const segRight = new Float32Array(L);
    const toI16 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v) * 32767;

    let segmentIdx = 0;
    for (let start = 0; start < totalSamples; start += stride) {
      const segmentLength = Math.min(start + L, totalSamples) - start;
      segLeft.fill(0); segRight.fill(0);
      segLeft.set(leftChannel.subarray(start, start + segmentLength));
      segRight.set(rightChannel.subarray(start, start + segmentLength));

      const tracks = await this._inferSegment(segLeft, segRight);

      for (let i = 0; i < segmentLength; i++) {
        const fadeIn = Math.min(i / (stride * 0.5), 1);
        const fadeOut = Math.min((segmentLength - i) / (stride * 0.5), 1);
        const w = Math.min(fadeIn, fadeOut);
        weights[i] += w;
        for (let t = 0; t < tracks.length; t++) {
          acc[t].left[i] += tracks[t].left[i] * w;
          acc[t].right[i] += tracks[t].right[i] * w;
        }
      }

      // Samples before the next segment get no more contributions: finalize them.
      const done = start + stride >= totalSamples ? totalSamples - start : stride;
      const chunk = {};
      for (let t = 0; t < TRACKS.length; t++) {
        const { left, right } = acc[t];
        // Целиком: левый канал в [0, n), правый в [n, 2n). Кусками: то же внутри куска.
        const out = onChunk ? new Int16Array(done * 2) : pcm[t];
        const lo = onChunk ? 0 : start, ro = onChunk ? done : totalSamples + start;
        for (let i = 0; i < done; i++) {
          const w = weights[i] > 0 ? weights[i] : 1;
          out[lo + i] = toI16(left[i] / w);
          out[ro + i] = toI16(right[i] / w);
        }
        if (onChunk) chunk[TRACKS[t]] = out;
        left.copyWithin(0, stride); left.fill(0, L - stride);
        right.copyWithin(0, stride); right.fill(0, L - stride);
      }
      weights.copyWithin(0, stride); weights.fill(0, L - stride);
      if (onChunk) await onChunk(start, chunk);

      segmentIdx++;
      this.onProgress({
        progress: segmentIdx / numSegments,
        currentSegment: segmentIdx,
        totalSegments: numSegments
      });
    }

    if (onChunk) return null;
    const result = {};
    TRACKS.forEach((key, t) => { result[key] = pcm[t]; });
    return result;
  }

  async separate(leftChannel, rightChannel) {
    if (!this.session) {
      throw new Error('Model not loaded. Call loadModel() first.');
    }

    const totalSamples = leftChannel.length;
    const stride = Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP));
    const numSegments = Math.ceil((totalSamples - TRAINING_SAMPLES) / stride) + 1;

    const outputs = TRACKS.map(() => ({
      left: new Float32Array(totalSamples),
      right: new Float32Array(totalSamples)
    }));
    const weights = new Float32Array(totalSamples);

    let segmentIdx = 0;

    for (let start = 0; start < totalSamples; start += stride) {
      const end = Math.min(start + TRAINING_SAMPLES, totalSamples);
      const segmentLength = end - start;

      const segLeft = new Float32Array(TRAINING_SAMPLES);
      const segRight = new Float32Array(TRAINING_SAMPLES);

      for (let i = 0; i < segmentLength; i++) {
        segLeft[i] = leftChannel[start + i];
        segRight[i] = rightChannel[start + i];
      }

      const input = prepareModelInput(segLeft, segRight);

      const waveformTensor = new this.ort.Tensor('float32', input.waveform, [1, 2, TRAINING_SAMPLES]);
      const magSpecTensor = new this.ort.Tensor('float32', input.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]);

      const feeds = {};
      feeds[this.session.inputNames[0]] = waveformTensor;
      if (this.session.inputNames.length > 1) {
        feeds[this.session.inputNames[1]] = magSpecTensor;
      }

      const inferResults = await this.session.run(feeds);

      let timeData = null, timeShape = null;
      let freqData = null;

      for (const name of this.session.outputNames) {
        const tensor = inferResults[name];
        if (tensor.dims.length === 4 && tensor.dims[2] === 2) {
          timeData = tensor.data;
          timeShape = tensor.dims;
        } else if (tensor.dims.length === 5 && tensor.dims[2] === 4) {
          freqData = tensor.data;
        }
      }

      if (!timeData) {
        throw new Error('Could not find time-domain output tensor');
      }

      let combinedOutputs = null;
      if (freqData) {
        const trackSpecs = standaloneMask(freqData);
        combinedOutputs = [];

        for (let t = 0; t < 4; t++) {
          const freqOutput = standaloneIspec(trackSpecs[t], TRAINING_SAMPLES);
          const numChannels = timeShape[2];
          const samples = timeShape[3];
          const timeLeft = new Float32Array(samples);
          const timeRight = new Float32Array(samples);

          for (let i = 0; i < samples; i++) {
            timeLeft[i] = timeData[t * numChannels * samples + 0 * samples + i];
            timeRight[i] = timeData[t * numChannels * samples + 1 * samples + i];
          }

          const combined = {
            left: new Float32Array(samples),
            right: new Float32Array(samples)
          };
          for (let i = 0; i < samples; i++) {
            combined.left[i] = timeLeft[i] + (freqOutput.left[i] || 0);
            combined.right[i] = timeRight[i] + (freqOutput.right[i] || 0);
          }
          combinedOutputs.push(combined);
        }
      }

      const numTracks = timeShape[1];
      const numChannels = timeShape[2];
      const samples = timeShape[3];

      const overlapWindow = new Float32Array(segmentLength);
      for (let i = 0; i < segmentLength; i++) {
        const fadeIn = Math.min(i / (stride * 0.5), 1);
        const fadeOut = Math.min((segmentLength - i) / (stride * 0.5), 1);
        overlapWindow[i] = Math.min(fadeIn, fadeOut);
      }

      for (let t = 0; t < numTracks; t++) {
        for (let i = 0; i < segmentLength && start + i < totalSamples; i++) {
          let leftVal, rightVal;
          if (combinedOutputs) {
            leftVal = combinedOutputs[t].left[i];
            rightVal = combinedOutputs[t].right[i];
          } else {
            const leftIdx = t * numChannels * samples + 0 * samples + i;
            const rightIdx = t * numChannels * samples + 1 * samples + i;
            leftVal = timeData[leftIdx];
            rightVal = timeData[rightIdx];
          }
          outputs[t].left[start + i] += leftVal * overlapWindow[i];
          outputs[t].right[start + i] += rightVal * overlapWindow[i];
        }
      }

      for (let i = 0; i < segmentLength && start + i < totalSamples; i++) {
        weights[start + i] += overlapWindow[i];
      }

      segmentIdx++;
      this.onProgress({
        progress: segmentIdx / numSegments,
        currentSegment: segmentIdx,
        totalSegments: numSegments
      });
    }

    for (let t = 0; t < TRACKS.length; t++) {
      for (let i = 0; i < totalSamples; i++) {
        if (weights[i] > 0) {
          outputs[t].left[i] /= weights[i];
          outputs[t].right[i] /= weights[i];
        }
      }
    }

    return {
      drums: outputs[0],
      bass: outputs[1],
      other: outputs[2],
      vocals: outputs[3]
    };
  }
}
