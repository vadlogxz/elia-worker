import { Env } from "../types/env";
import { ConversationSettings, ConversationResponse } from "../types/api.types";
import { transcribeAudio } from "../services/openai/stt.service";
import { tutorChat } from "../services/openai/chat.service";
import { synthesizeSpeech, arrayBufferToBase64 } from "../services/openai/tts.service";

const EMPTY_AUDIO_RESPONSE: ConversationResponse = {
  user_text: "",
  reply_text: "Sorry, I didn't catch that. Could you say it again?",
  reply_audio: "",
  corrected: null,
  has_error: false,
  vocabulary: [],
};

export async function handleConversation(request: Request, env: Env): Promise<Response> {
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

  const settingsRaw = formData.get("settings");
  if (!settingsRaw || typeof settingsRaw !== "string") {
    return jsonError("Missing or invalid 'settings' field", 400);
  }

  let settings: ConversationSettings;
  try {
    settings = JSON.parse(settingsRaw) as ConversationSettings;
  } catch {
    return jsonError("'settings' is not valid JSON", 400);
  }

  if (!settings.agent_id || !settings.target_language || !settings.native_language) {
    return jsonError("'settings' must contain agent_id, target_language, native_language", 400);
  }

  const pcmBytes = await audioFile.arrayBuffer();
  if (pcmBytes.byteLength === 0) {
    return jsonResponse(EMPTY_AUDIO_RESPONSE);
  }

  // 1. STT
  let userText: string;
  try {
    userText = await transcribeAudio(pcmBytes, settings.target_language, env);
  } catch {
    return jsonResponse(EMPTY_AUDIO_RESPONSE);
  }

  if (!userText.trim()) {
    return jsonResponse(EMPTY_AUDIO_RESPONSE);
  }

  // 2. LLM
  let llm;
  try {
    llm = await tutorChat(userText, settings, env);
  } catch (err) {
    const message = err instanceof Error ? err.message : "LLM failed";
    return jsonError(message, 502);
  }

  // 3. TTS
  let replyAudio = "";
  try {
    const wavBuffer = await synthesizeSpeech(llm.reply_text, settings.target_language, env);
    if (wavBuffer) {
      replyAudio = arrayBufferToBase64(wavBuffer);
    }
  } catch {
    // TTS failure is non-fatal — client handles empty reply_audio
  }

  // 4. Assemble response
  const response: ConversationResponse = {
    user_text: userText,
    reply_text: llm.reply_text,
    reply_audio: replyAudio,
    corrected: llm.corrected,
    has_error: llm.has_error,
    vocabulary: llm.vocabulary,
  };

  return jsonResponse(response);
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
