import { router } from "./router";
import { handleOptions, withCors } from "./middleware/cors";
import { Env } from "./types/env";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {

    // CORS preflight handling
    const options = handleOptions(request);
    if (options) return options;

    // Route the request
    const response = await router(request, env);

    // Add CORS headers to the response
    return withCors(response);
  }
};