import { Env } from "../types/env";
import { config } from "../config/env";
import { transcribeAudio } from "../services/openai/stt.service";

export async function handleStt(request: Request, env: Env): Promise<Response> {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return jsonError("Failed to parse multipart form data", 400);
	}

	const audioFile = formData.get("audio");
	if (!audioFile || !(audioFile instanceof File)) {
		return jsonError("Missing or invalid 'audio' field", 400);
	}

	const pcmBytes = await audioFile.arrayBuffer();
	if (pcmBytes.byteLength === 0) {
		return jsonError("Audio file is empty", 400);
	}

	const language = (formData.get("language") as string | null) ?? config.OPENAI_STT_LANGUAGE;

	try {
		const text = await transcribeAudio(pcmBytes, language, env);
		return new Response(JSON.stringify({ text }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Transcription failed";
		return jsonError(message, 502);
	}
}

function jsonError(message: string, status: number): Response {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
