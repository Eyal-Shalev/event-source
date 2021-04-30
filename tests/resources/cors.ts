import { Context } from "https://deno.land/x/oak@v7.3.0/mod.ts";

export const handler = (ctx: Context) => {
  const searchParams = ctx.request.url.searchParams;
  const reqHeaders = ctx.request.headers;

  const lastEventID = reqHeaders.get("Last-Event-Id") || "";
  const ident = searchParams.get("ident") || "test";
  const cookie = ctx.cookies.get(ident) ? "COOKIE" : "NO_COOKIE";
  const origin = searchParams.get("origin") || reqHeaders.get("origin");
  const credentials = searchParams.get("credentials") || "true";

  if (origin) ctx.response.headers.set("Access-Control-Allow-Origin", origin);
  ctx.response.headers.set("Access-Control-Allow-Credentials", credentials);

  const handler = searchParams.get("run");
  const validHandlers: (string | null)[] = [
    "status-reconnect",
    "message",
    "redirect",
    "cache-control",
  ];
  if (!validHandlers.includes(handler)) return;

  switch (handler) {
    case "cache-control":
      ctx.response.headers.set("Content-Type", "text/event-stream");
      
      break;

    default:
      break;
  }
};
