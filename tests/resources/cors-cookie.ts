import { Context } from "https://deno.land/x/oak@v7.3.0/mod.ts";

export const handler = (ctx: Context) => {
  const searchParams = ctx.request.url.searchParams;
  const reqHeaders = ctx.request.headers;
  const lastEventID = reqHeaders.get("Last-Event-Id") || "";
  const ident = searchParams.get("ident") || "test";
  const cookie = ctx.cookies.get(ident) ? "COOKIE" : "NO_COOKIE";
  const origin = searchParams.get("origin") || reqHeaders.get("origin");
  const credentials = searchParams.get("credentials") || "true";

  ctx.response.headers = new Headers();

  if (origin && origin !== "none") {
    ctx.response.headers.append("Access-Control-Allow-Origin", origin);
  }

  if (credentials !== "none") {
    ctx.response.headers.append(
      "Access-Control-Allow-Credentials",
      credentials,
    );
  }

  if (lastEventID === "") {
    ctx.response.headers.append("Content-Type", "text/event-stream");
    ctx.cookies.set(ident, "COOKIE");
    ctx.response.body = `id: 1\nretry: 200\ndata: first ${cookie}\n\n`;
  } else if (lastEventID === "1") {
    ctx.response.headers.append("Content-Type", "text/event-stream");
    const longLongTimeAgo = new Date(2001, 7, 27);
    ctx.cookies.set(ident, "COOKIE", { expires: longLongTimeAgo });
    ctx.response.body = `id: 2\ndata: second ${cookie}\n\n`;
  } else {
    ctx.response.headers.append("Content-Type", "stop");
    ctx.response.body = `data: ${lastEventID}${cookie}\n\n`;
  }
};
