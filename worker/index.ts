interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/__health" && request.method === "GET") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }
    return env.ASSETS.fetch(request);
  },
};
