import { Env } from "../../types/env";
import { config } from "../../config/env";

const TTS_API = "https://api.openai.com/v1/audio/speech";

const LANGUAGE_TO_VOICE: Record<string, string> = {
  en: "nova",
  uk: "alloy",
  it: "shimmer",
  es: "echo",
  de: "onyx",
  fr: "fable",
};

export async function synthesizeSpeech(
  text: string,
  language: string,
  env: Env
): Promise<ArrayBuffer | null> {
  const voice = LANGUAGE_TO_VOICE[language] ?? "nova";

  let response: Response;
  try {
    response = await fetch(TTS_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.OPENAI_TTS_MODEL,
        input: text,
        voice,
        response_format: "mp3",
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  return response.arrayBuffer();
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
