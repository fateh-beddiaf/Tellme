import { STTOptions, STTResult, STTError } from './types';
import { WhisperLocalProvider } from './providers/whisper-local';
import { CloudWhisperProvider } from './providers/cloud-whisper';

export class STTService {
	private localProvider: WhisperLocalProvider;
	private cloudProvider: CloudWhisperProvider;

	constructor() {
		this.localProvider = new WhisperLocalProvider();
		this.cloudProvider = new CloudWhisperProvider();
	}

	async transcribe(
		audioFilePath: string,
		audioBuffer: ArrayBuffer,
		options: STTOptions,
	): Promise<STTResult> {
		if (options.provider === 'whisper.cpp') {
			return this.localProvider.transcribe(audioFilePath, options);
		} else if (
			options.provider === 'groq' ||
			options.provider === 'openai' ||
			options.provider === 'openrouter' ||
			options.provider === 'custom'
		) {
			return this.cloudProvider.transcribe(audioBuffer, options);
		} else {
			throw new STTError(
				`Unsupported STT provider: ${options.provider as string}`,
				options.provider,
			);
		}
	}
}
