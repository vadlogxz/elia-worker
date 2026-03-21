import { Env } from "./types/env";
import { handleStt } from "./routes/stt.route";
import { handleChat } from "./routes/chat.route";
import { handleTts } from "./routes/tts.route";
import { handleConversation } from "./routes/conversation.route";

export async function router(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname === "/stt" && request.method === "POST") {
    return handleStt(request, env);
  }

  if (url.pathname === "/chat" && request.method === "POST") {
    return handleChat(request, env);
  }

  if (url.pathname === "/tts" && request.method === "POST") {
    return handleTts(request, env);
  }

  if (url.pathname === "/conversation" && request.method === "POST") {
    return handleConversation(request, env);
  }

  return new Response("Not Found", { status: 404 });
}