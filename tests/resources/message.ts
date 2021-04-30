import { Context } from "https://deno.land/x/oak@v7.3.0/mod.ts";
import { sleep } from "../../_utils.ts";

export const handler = async (ctx: Context) => {
  const searchParams = ctx.request.url.searchParams;
  const mime = searchParams.get("mime") || "text/event-stream";
  const message = searchParams.get("message") || "data: data";
  const newline = searchParams.get("newline") === "none" ? "" : "\n\n";
  const sleepFor = parseInt(searchParams.get("sleep") || "0");
  if (sleepFor > 0) {
    await sleep(sleepFor);
  }
  ctx.response.headers = new Headers({ "Content-Type": mime });
  ctx.response.body = message + newline + "\n";
};
