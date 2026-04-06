import { Env } from "../../types/env";
import { config } from "../../config/env";
import { buildSttPrompt } from "../prompts/english-tutor.prompt";

const WHISPER_API = "https://api.openai.com/v1/audio/transcriptions";

/** Wraps raw PCM bytes in a minimal WAV container (16kHz, 16-bit, mono). */
function pcmToWav(pcm: ArrayBuffer): ArrayBuffer {
	const sampleRate = 16000;
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
	const blockAlign = (numChannels * bitsPerSample) / 8;
	const dataSize = pcm.byteLength;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	const write = (offset: number, value: number, size: number) =>
		size === 4 ? view.setUint32(offset, value, true) : view.setUint16(offset, value, true);

	// RIFF header
	new Uint8Array(buffer).set([82, 73, 70, 70], 0); // "RIFF"
	write(4, 36 + dataSize, 4);
	new Uint8Array(buffer).set([87, 65, 86, 69], 8); // "WAVE"
	new Uint8Array(buffer).set([102, 109, 116, 32], 12); // "fmt "
	write(16, 16, 4); // chunk size
	write(20, 1, 2);  // PCM format
	write(22, numChannels, 2);
	write(24, sampleRate, 4);
	write(28, byteRate, 4);
	write(32, blockAlign, 2);
	write(34, bitsPerSample, 2);
	new Uint8Array(buffer).set([100, 97, 116, 97], 36); // "data"
	write(40, dataSize, 4);
	new Uint8Array(buffer).set(new Uint8Array(pcm), 44);

	return buffer;
}

export async function transcribeAudio(pcmBytes: ArrayBuffer, language: string, env: Env): Promise<string> {
	const wav = pcmToWav(pcmBytes);
	const blob = new Blob([wav], { type: "audio/wav" });

	const form = new FormData();
	form.append("file", blob, "audio.wav");
	form.append("model", config.OPENAI_STT_MODEL);
	form.append("language", language);
	form.append("prompt", buildSttPrompt(language));

	const response = await fetch(WHISPER_API, {
		method: "POST",
		headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
		body: form,
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Whisper API error [${response.status}]: ${error}`);
	}

	const result = (await response.json()) as { text: string };
	return result.text;
}
