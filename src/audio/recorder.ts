import { Platform } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { encodeWAV, resampleAudio } from './wav-encoder';

export interface RecordingResult {
	filePath: string;
	durationMs: number;
	buffer: ArrayBuffer;
}

export class AudioRecorder {
	private mediaStream: MediaStream | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private audioChunks: Blob[] = [];
	private startTime: number = 0;
	private recording: boolean = false;

	isRecording(): boolean {
		return this.recording;
	}

	async start(): Promise<void> {
		if (this.recording) {
			return;
		}

		if (!navigator.mediaDevices?.getUserMedia) {
			throw new Error('Microphone audio capture is not supported in this environment.');
		}

		this.audioChunks = [];
		this.startTime = Date.now();

		this.mediaStream = await navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: true,
			},
		});

		const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
			? 'audio/webm;codecs=opus'
			: MediaRecorder.isTypeSupported('audio/webm')
				? 'audio/webm'
				: '';

		this.mediaRecorder = mimeType
			? new MediaRecorder(this.mediaStream, { mimeType })
			: new MediaRecorder(this.mediaStream);

		this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
			if (event.data && event.data.size > 0) {
				this.audioChunks.push(event.data);
			}
		};

		this.mediaRecorder.start(100);
		this.recording = true;
	}

	async stop(): Promise<RecordingResult | null> {
		if (!this.recording || !this.mediaRecorder) {
			return null;
		}

		this.recording = false;
		const durationMs = Date.now() - this.startTime;

		const recordedBlobs = await new Promise<Blob[]>((resolve) => {
			if (!this.mediaRecorder) {
				resolve([]);
				return;
			}

			this.mediaRecorder.onstop = () => {
				resolve([...this.audioChunks]);
			};

			this.mediaRecorder.stop();
		});

		this.cleanup();

		// A recording shorter than this produces a header-only webm blob
		// (MediaRecorder flushes the first Opus cluster ~1s in), which
		// decodeAudioData rejects with "Unable to decode audio data".
		// Discard it here with a graceful "nothing captured" result instead.
		const MIN_DURATION_MS = 600;
		if (durationMs < MIN_DURATION_MS) {
			return null;
		}

		if (recordedBlobs.length === 0) {
			return null;
		}

		const combinedBlob = new Blob(recordedBlobs, {
			type: recordedBlobs[0]?.type || 'audio/webm',
		});

		if (combinedBlob.size === 0) {
			return null;
		}

		const arrayBuffer = await combinedBlob.arrayBuffer();

		// Decode captured audio using AudioContext to extract PCM channel data
		const AudioCtxClass =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext: typeof AudioContext })
				.webkitAudioContext;
		const audioCtx = new AudioCtxClass();

		let wavBuffer: ArrayBuffer;
		try {
			// Harmless if already running; covers environments with a
			// stricter autoplay policy than Obsidian desktop's default.
			if (audioCtx.state === 'suspended') {
				try {
					await audioCtx.resume();
				} catch {
					// Decode does not require a running context — continue anyway.
				}
			}
			const decodedAudio = await audioCtx.decodeAudioData(arrayBuffer);
			const channelData = decodedAudio.getChannelData(0);

			// Resample to 16kHz standard for whisper.cpp and STT engines
			const targetSampleRate = 16000;
			const resampled = resampleAudio(
				channelData,
				decodedAudio.sampleRate,
				targetSampleRate,
			);

			// Encode to standard 16-bit PCM Mono WAV
			wavBuffer = encodeWAV(resampled, targetSampleRate);
		} catch {
			// Decode failed on a real (>=600 ms) recording: the webm blob is
			// truncated or undecodable. Fail loudly with an actionable
			// message rather than the cryptic DOMException text.
			throw new Error(
				'The recording could not be decoded (it may be corrupted by a suspended window). Please try recording again.',
			);
		} finally {
			if (audioCtx.state !== 'closed') {
				void audioCtx.close();
			}
		}

		// Save to temporary file on disk for STT consumption
		let tempFilePath = '';
		if (Platform.isDesktop) {
			const tempDir = os.tmpdir();
			tempFilePath = path.join(
				tempDir,
				`tellme_recording_${Date.now()}.wav`,
			);
			await fs.promises.writeFile(
				tempFilePath,
				Buffer.from(wavBuffer),
			);
		}

		return {
			filePath: tempFilePath,
			durationMs,
			buffer: wavBuffer,
		};
	}

	cancel(): void {
		this.recording = false;
		this.audioChunks = [];
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			try {
				this.mediaRecorder.stop();
			} catch {
				// Ignore stop errors on cancel
			}
		}
		this.cleanup();
	}

	private cleanup(): void {
		try {
			this.mediaRecorder = null;
			if (this.mediaStream) {
				this.mediaStream.getTracks().forEach((track) => track.stop());
				this.mediaStream = null;
			}
		} catch {
			// Ignore cleanup errors
		}
	}
}
