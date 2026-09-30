import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'crypto';
import * as nodeTimers from 'node:timers';
import { ModelManager } from '../src/models/model-manager.ts';
import type { ModelInfo } from '../src/models/types.ts';

/**
 * A local server that behaves like a flaky connection: the first full
 * request is cut off halfway; Range requests are served properly.
 */
void describe('Model download - resume after an interrupted connection', () => {
	const payload = crypto.randomBytes(512 * 1024);
	const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
	const rangeRequests: string[] = [];
	let cutFirstRequest = true;
	let server: http.Server;
	let baseUrl = '';
	let dir: string;

	before(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tellme-resume-'));
		server = http.createServer((req, res) => {
			const range = req.headers.range;
			if (range) {
				rangeRequests.push(range);
				const start = parseInt(/bytes=(\d+)-/.exec(range)?.[1] ?? '0', 10);
				res.writeHead(206, {
					'Content-Length': payload.length - start,
					'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
				});
				res.end(payload.subarray(start));
				return;
			}
			res.writeHead(200, { 'Content-Length': payload.length });
			if (cutFirstRequest) {
				cutFirstRequest = false;
				// Send half, then drop the connection like a network hiccup.
				res.write(payload.subarray(0, payload.length / 2), () => {
					nodeTimers.setTimeout(() => req.socket.destroy(), 50);
				});
				return;
			}
			res.end(payload);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address() as { port: number };
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	after(() => {
		server.close();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const model = (): ModelInfo => ({
		id: 'test-model',
		name: 'Test model',
		type: 'llm',
		profile: 'fast',
		sizeBytes: payload.length,
		sizeFormatted: '0.5 MB',
		ramRequired: '-',
		description: '-',
		fileName: 'test-model.gguf',
		downloadUrl: `${baseUrl}/test-model.gguf`,
		sha256,
	});

	let partialAfterDrop = 0;

	void test('interrupted download fails clearly and keeps what arrived', async () => {
		const manager = new ModelManager({} as never, dir);
		await assert.rejects(manager.downloadModelFile(model()), /interrupted.*Click Download again/);
		const tmp = path.join(dir, 'test-model.gguf.tmp');
		// How much reached the disk before the drop depends on timing (it can
		// be 0 on a busy machine); it must never be the whole file.
		partialAfterDrop = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
		assert.ok(partialAfterDrop < payload.length, `partial size ${partialAfterDrop}`);
	});

	void test('the retry resumes from exactly what is on disk and completes byte-perfect', async () => {
		const manager = new ModelManager({} as never, dir);
		const finalPath = await manager.downloadModelFile(model());
		if (partialAfterDrop > 0) {
			assert.deepStrictEqual(rangeRequests, [`bytes=${partialAfterDrop}-`]);
		} else {
			assert.deepStrictEqual(rangeRequests, [], 'nothing on disk → fresh download');
		}
		assert.ok(fs.readFileSync(finalPath).equals(payload), 'file matches the original');
		assert.strictEqual(fs.existsSync(`${finalPath}.tmp`), false, 'temp file cleaned up');
	});

	void test('a partial file on disk is resumed with a Range request (deterministic)', async () => {
		rangeRequests.length = 0;
		const resumed = { ...model(), id: 'resumed', fileName: 'resumed.gguf' };
		const half = payload.length / 2;
		fs.writeFileSync(path.join(dir, 'resumed.gguf.tmp'), payload.subarray(0, half));
		const manager = new ModelManager({} as never, dir);
		const finalPath = await manager.downloadModelFile(resumed);
		assert.deepStrictEqual(rangeRequests, [`bytes=${half}-`]);
		assert.ok(fs.readFileSync(finalPath).equals(payload), 'file matches the original');
	});

	void test('a checksum mismatch deletes the file instead of keeping it', async () => {
		const manager = new ModelManager({} as never, dir);
		const bad = { ...model(), id: 'bad', fileName: 'bad.gguf', sha256: '0'.repeat(64) };
		await assert.rejects(manager.downloadModelFile(bad), /safety check/);
		assert.strictEqual(fs.existsSync(path.join(dir, 'bad.gguf')), false);
		assert.strictEqual(fs.existsSync(path.join(dir, 'bad.gguf.tmp')), false);
	});
});
