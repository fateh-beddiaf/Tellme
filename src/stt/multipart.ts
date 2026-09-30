export interface MultipartField {
	name: string;
	value: string;
}

export interface MultipartFile {
	name: string;
	filename: string;
	contentType: string;
	data: ArrayBuffer;
}

export interface MultipartPayload {
	contentType: string;
	body: ArrayBuffer;
}

export function buildMultipartFormData(
	fields: MultipartField[],
	files: MultipartFile[],
): MultipartPayload {
	const boundary = `----TellmeBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [];

	// Add standard text fields
	for (const field of fields) {
		let header = `--${boundary}\r\n`;
		header += `Content-Disposition: form-data; name="${field.name}"\r\n\r\n`;
		header += `${field.value}\r\n`;
		chunks.push(encoder.encode(header));
	}

	// Add file fields
	for (const file of files) {
		let header = `--${boundary}\r\n`;
		header += `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`;
		header += `Content-Type: ${file.contentType}\r\n\r\n`;
		chunks.push(encoder.encode(header));
		chunks.push(new Uint8Array(file.data));
		chunks.push(encoder.encode('\r\n'));
	}

	// Add closing boundary
	chunks.push(encoder.encode(`--${boundary}--\r\n`));

	// Calculate total length
	let totalLength = 0;
	for (const chunk of chunks) {
		totalLength += chunk.byteLength;
	}

	// Merge all chunks into single Uint8Array
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return {
		contentType: `multipart/form-data; boundary=${boundary}`,
		body: result.buffer,
	};
}
