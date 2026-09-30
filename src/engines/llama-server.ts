import * as fs from 'fs';
import * as net from 'net';
import * as http from 'http';
import * as path from 'path';
import * as crypto from 'crypto';
import * as child_process from 'child_process';
import type { ProgramInstaller } from './program-installer.ts';
import {
	buildLlamaServerArgs,
	LLAMA_IDLE_SHUTDOWN_MS,
	LLAMA_STARTUP_TIMEOUT_MS,
} from './llama-args.ts';

export interface LlamaEndpoint {
	baseUrl: string;
	apiKey: string;
}

interface RunningServer {
	child: child_process.ChildProcess;
	modelPath: string;
	useGpu: boolean;
	gpuBuild: boolean;
	endpoint: LlamaEndpoint;
}

/**
 * Starts llama.cpp's `llama-server` only when a note needs cleaning, keeps
 * it warm between notes, and stops it after 5 idle minutes and on plugin
 * unload. A PID file lets the next launch clean up a server orphaned by a
 * crash (a Node child is not killed with its parent on Windows).
 */
export class LlamaServerManager {
	private installer: ProgramInstaller;
	private pidFile: string;
	private running: RunningServer | null = null;
	private starting: Promise<LlamaEndpoint> | null = null;
	private idleTimer: number | null = null;

	constructor(installer: ProgramInstaller) {
		this.installer = installer;
		this.pidFile = path.join(installer.getEnginesDir(), 'llama-server.pid');
	}

	isRunning(): boolean {
		return this.running !== null;
	}

	/**
	 * Get a ready server for this model, starting (or restarting) it if needed.
	 * `useGpu` controls GPU offload; `gpuBuild` picks which installed build runs.
	 */
	async acquire(modelPath: string, useGpu: boolean, gpuBuild: boolean): Promise<LlamaEndpoint> {
		const current = this.running;
		if (
			current &&
			current.modelPath === modelPath &&
			current.useGpu === useGpu &&
			current.gpuBuild === gpuBuild
		) {
			this.touch();
			return current.endpoint;
		}
		if (this.starting) {
			return this.starting;
		}
		this.stop();
		this.starting = this.start(modelPath, useGpu, gpuBuild).finally(() => {
			this.starting = null;
		});
		const endpoint = await this.starting;
		this.touch();
		return endpoint;
	}

	/** Push the idle shutdown back (call after every request). */
	touch(): void {
		if (this.idleTimer !== null) {
			window.clearTimeout(this.idleTimer);
		}
		this.idleTimer = window.setTimeout(() => this.stop(), LLAMA_IDLE_SHUTDOWN_MS);
	}

	stop(): void {
		if (this.idleTimer !== null) {
			window.clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
		const server = this.running;
		this.running = null;
		if (server && server.child.exitCode === null) {
			server.child.kill();
		}
		fs.rmSync(this.pidFile, { force: true });
	}

	/** Kill a llama-server left running by a previous crash of Obsidian. */
	async cleanupOrphan(): Promise<void> {
		let pid: number;
		try {
			pid = parseInt(await fs.promises.readFile(this.pidFile, 'utf8'), 10);
		} catch {
			return; // no PID file — nothing to clean up
		}
		if (Number.isFinite(pid) && pid > 0 && (await isLlamaServerProcess(pid))) {
			try {
				process.kill(pid);
			} catch {
				// Already gone
			}
		}
		await fs.promises.rm(this.pidFile, { force: true });
	}

	private async start(modelPath: string, useGpu: boolean, gpuBuild: boolean): Promise<LlamaEndpoint> {
		const binary = this.installer.getInstalledPath(gpuBuild);
		if (!binary) {
			throw new Error('The cleanup engine is not installed yet.');
		}
		if (!fs.existsSync(modelPath)) {
			throw new Error(`Cleanup model file not found at: "${modelPath}". Re-download it in Settings → Local model manager.`);
		}

		const port = await findFreePort();
		const apiKey = crypto.randomBytes(24).toString('hex');
		const args = buildLlamaServerArgs({ modelPath, port, apiKey, useGpu, contextSize: 8192 });

		const child = child_process.spawn(binary, args, {
			windowsHide: true,
			stdio: ['ignore', 'ignore', 'pipe'],
			env: libraryPathEnv(binary),
		});

		// Keep the last lines of the server log for error messages.
		let logTail = '';
		child.stderr?.on('data', (chunk: Buffer) => {
			logTail = (logTail + chunk.toString()).slice(-4000);
		});

		const endpoint = { baseUrl: `http://127.0.0.1:${port}`, apiKey };
		this.running = { child, modelPath, useGpu, gpuBuild, endpoint };
		if (child.pid) {
			await fs.promises.writeFile(this.pidFile, String(child.pid)).catch(() => undefined);
		}
		child.on('exit', () => {
			if (this.running?.child === child) {
				this.running = null;
				fs.rmSync(this.pidFile, { force: true });
			}
		});

		try {
			await waitUntilReady(endpoint.baseUrl, child, LLAMA_STARTUP_TIMEOUT_MS);
			return endpoint;
		} catch (error) {
			this.stop();
			const reason = error instanceof Error ? error.message : 'unknown error';
			const lastLine = logTail.trim().split('\n').slice(-3).join(' ').slice(-400);
			throw new Error(`The cleanup engine could not start (${reason}).${lastLine ? ` Log: ${lastLine}` : ''}`);
		}
	}
}

/** Ask the OS for an unused loopback port. */
function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = typeof address === 'object' && address ? address.port : 0;
			server.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
		});
	});
}

/** Poll /health until the model is loaded (200), the process dies, or time runs out. */
async function waitUntilReady(
	baseUrl: string,
	child: child_process.ChildProcess,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`it exited with code ${child.exitCode}`);
		}
		if ((await healthStatus(baseUrl)) === 200) {
			return;
		}
		await new Promise((resolve) => window.setTimeout(resolve, 250));
	}
	throw new Error('timed out while loading the model');
}

function healthStatus(baseUrl: string): Promise<number> {
	return new Promise((resolve) => {
		const req = http.get(`${baseUrl}/health`, { timeout: 2000 }, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		});
		req.on('timeout', () => req.destroy());
		req.on('error', () => resolve(0));
	});
}

/** Linux/macOS builds ship their shared libraries next to the program. */
function libraryPathEnv(binary: string): NodeJS.ProcessEnv {
	const dir = path.dirname(binary);
	if (process.platform === 'linux') {
		const existing = process.env.LD_LIBRARY_PATH;
		return { ...process.env, LD_LIBRARY_PATH: existing ? `${dir}:${existing}` : dir };
	}
	if (process.platform === 'darwin') {
		const existing = process.env.DYLD_LIBRARY_PATH;
		return { ...process.env, DYLD_LIBRARY_PATH: existing ? `${dir}:${existing}` : dir };
	}
	return process.env;
}

/** Only kill a PID from our file if it really is llama-server (PIDs get reused). */
function isLlamaServerProcess(pid: number): Promise<boolean> {
	return new Promise((resolve) => {
		const [cmd, args] =
			process.platform === 'win32'
				? ['tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']]
				: ['ps', ['-p', String(pid), '-o', 'comm=']];
		child_process.execFile(cmd, args, { windowsHide: true }, (error, stdout) => {
			resolve(!error && /llama-server/i.test(stdout));
		});
	});
}

/**
 * POST JSON to the local server (Node http: the server is loopback-only and
 * authenticated with the per-launch key). Resolves with status + parsed body.
 */
export function postJson(
	endpoint: LlamaEndpoint,
	urlPath: string,
	body: unknown,
	timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
	const data = JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = http.request(
			`${endpoint.baseUrl}${urlPath}`,
			{
				method: 'POST',
				timeout: timeoutMs,
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(data),
					Authorization: `Bearer ${endpoint.apiKey}`,
				},
			},
			(res) => {
				let text = '';
				res.setEncoding('utf8');
				res.on('data', (chunk: string) => (text += chunk));
				res.on('end', () => {
					let parsed: unknown = text;
					try {
						parsed = JSON.parse(text);
					} catch {
						// keep raw text
					}
					resolve({ status: res.statusCode ?? 0, body: parsed });
				});
			},
		);
		req.on('timeout', () => req.destroy(new Error('the cleanup engine took too long to answer')));
		req.on('error', reject);
		req.write(data);
		req.end();
	});
}
