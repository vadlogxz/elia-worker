import { Env } from "../../types/env";
import { config } from "../../config/env";
import { LlmResponse, ConversationSettings } from "../../types/api.types";
import { buildTutorSystemPrompt } from "../prompts/english-tutor.prompt";

const CHAT_API = "https://api.openai.com/v1/chat/completions";

export async function tutorChat(
  userText: string,
  settings: ConversationSettings,
  env: Env
): Promise<LlmResponse> {
  const systemPrompt = buildTutorSystemPrompt(
    settings.agent_id,
    settings.target_language,
    settings.native_language
  );

  const history = (settings.history ?? []).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const messages = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: userText },
  ];

  const body = JSON.stringify({
    model: config.OPENAI_CHAT_MODEL,
    response_format: { type: "json_object" },
    messages,
    temperature: 0.7,
  });

  const response = await fetch(CHAT_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI Chat API error [${response.status}]: ${error}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };

  const raw = data.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<LlmResponse>;

  return {
    reply_text: parsed.reply_text ?? "Sorry, I couldn't generate a response.",
    corrected: parsed.corrected ?? null,
    has_error: parsed.has_error ?? false,
    vocabulary: parsed.vocabulary ?? [],
  };
}
