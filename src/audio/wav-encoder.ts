/**
 * Encodes raw Float32 audio samples into a standard 16-bit PCM Mono WAV buffer.
 */
export function encodeWAV(
	samples: Float32Array,
	sampleRate: number = 16000,
): ArrayBuffer {
	const numChannels = 1;
	const bytesPerSample = 2; // 16-bit PCM
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataLength = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataLength);
	const view = new DataView(buffer);

	// Helper to write ASCII strings
	const writeString = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) {
			view.setUint8(offset + i, str.charCodeAt(i));
		}
	};

	// 1. RIFF Chunk Descriptor
	writeString(0, 'RIFF');
	view.setUint32(4, 36 + dataLength, true); // ChunkSize
	writeString(8, 'WAVE');

	// 2. "fmt " Sub-chunk
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
	view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
	view.setUint16(22, numChannels, true); // NumChannels (1 = mono)
	view.setUint32(24, sampleRate, true); // SampleRate
	view.setUint32(28, byteRate, true); // ByteRate
	view.setUint16(32, blockAlign, true); // BlockAlign
	view.setUint16(34, 16, true); // BitsPerSample (16 bits)

	// 3. "data" Sub-chunk
	writeString(36, 'data');
	view.setUint32(40, dataLength, true); // Subchunk2Size

	// Write PCM 16-bit audio samples
	let offset = 44;
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
		// Convert float [-1.0, 1.0] to 16-bit signed integer [-32768, 32767]
		const val = s < 0 ? s * 0x8000 : s * 0x7fff;
		view.setInt16(offset, val, true);
		offset += 2;
	}

	return buffer;
}

/**
 * Linear interpolation resampling helper from input sample rate to target sample rate.
 */
export function resampleAudio(
	audioData: Float32Array,
	fromSampleRate: number,
	toSampleRate: number = 16000,
): Float32Array {
	if (fromSampleRate === toSampleRate || audioData.length === 0) {
		return audioData;
	}

	const ratio = fromSampleRate / toSampleRate;
	const newLength = Math.round(audioData.length / ratio);
	const result = new Float32Array(newLength);

	for (let i = 0; i < newLength; i++) {
		const sourceIndex = i * ratio;
		const indexPrev = Math.floor(sourceIndex);
		const indexNext = Math.min(indexPrev + 1, audioData.length - 1);
		const fraction = sourceIndex - indexPrev;

		const samplePrev = audioData[indexPrev] ?? 0;
		const sampleNext = audioData[indexNext] ?? 0;

		result[i] = samplePrev + fraction * (sampleNext - samplePrev);
	}

	return result;
}
