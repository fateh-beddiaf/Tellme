import { Platform } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { STTOptions, STTResult, STTError } from '../types';

export class WhisperLocalProvider {
	async transcribe(
		audioFilePath: string,
		options: STTOptions,
	): Promise<STTResult> {
		if (!Platform.isDesktop) {
			throw new STTError(
				'Local whisper.cpp transcription is only supported on Obsidian desktop.',
				'whisper.cpp',
			);
		}

		const cliPath = options.whisperCliPath.trim();
		const modelPath = options.whisperModelPath.trim();

		if (!cliPath) {
			throw new STTError(
				process.platform === 'darwin'
					? 'The speech engine (whisper.cpp) is not installed. On Mac, install it once with Homebrew: brew install whisper-cpp — then record again.'
					: 'The speech engine is not installed yet. Open Settings → Tellme → Transcription and click "Download speech engine" (it also comes automatically with any Whisper model download).',
				'whisper.cpp',
			);
		}

		if (!fs.existsSync(cliPath)) {
			throw new STTError(
				`whisper.cpp program not found at: "${cliPath}". Check the custom path under Settings → Transcription → Advanced, or clear it to use the built-in speech engine.`,
				'whisper.cpp',
			);
		}

		if (!modelPath) {
			throw new STTError(
				'No speech model chosen yet. Open Settings → Tellme → Local model manager and download a Whisper model (Whisper Base is a good start).',
				'whisper.cpp',
			);
		}

		if (!fs.existsSync(modelPath)) {
			throw new STTError(
				`Speech model file not found at: "${modelPath}". Re-download it in Settings → Local model manager.`,
				'whisper.cpp',
			);
		}

		if (!fs.existsSync(audioFilePath)) {
			throw new STTError(
				`Audio file not found at: "${audioFilePath}".`,
				'whisper.cpp',
			);
		}

		const startTime = Date.now();
		const args: string[] = [
			'-m',
			modelPath,
			'-f',
			audioFilePath,
			'-nt', // No timestamps in standard output
		];

		if (options.language && options.language !== 'auto') {
			args.push('-l', options.language);
		}

		return new Promise<STTResult>((resolve, reject) => {
			child_process.execFile(
				cliPath,
				args,
				{
					maxBuffer: 10 * 1024 * 1024,
					windowsHide: true,
					env: whisperEnv(cliPath),
				},
				(error, stdout, stderr) => {
					const durationMs = Date.now() - startTime;

					if (error) {
						const details = stderr ? `: ${stderr.trim()}` : '';
						reject(
							new STTError(
								`whisper.cpp failed execution (code ${error.code ?? 'unknown'})${details}`,
								'whisper.cpp',
							),
						);
						return;
					}

					// Process output text: remove system messages / timestamps if any
					let outputText = stdout.trim();

					// If stdout is empty, check if whisper printed transcript to stderr
					if (!outputText && stderr) {
						const lines = stderr.split('\n');
						const transcriptLines = lines.filter(
							(l) => !l.startsWith('whisper_') && !l.startsWith('main:'),
						);
						outputText = transcriptLines.join(' ').trim();
					}

					resolve({
						text: outputText,
						durationMs,
						provider: 'whisper.cpp',
					});
				},
			);
		});
	}
}

/**
 * The official Linux build ships its shared libraries (libwhisper.so,
 * libggml*.so) next to the program; let the loader find them there.
 */
function whisperEnv(cliPath: string): NodeJS.ProcessEnv {
	if (process.platform !== 'linux') {
		return process.env;
	}
	const libDir = path.dirname(cliPath);
	const existing = process.env.LD_LIBRARY_PATH;
	return {
		...process.env,
		LD_LIBRARY_PATH: existing ? `${libDir}:${existing}` : libDir,
	};
}
