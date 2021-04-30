import { Context } from "https://deno.land/x/oak@v7.3.0/mod.ts";

export const handler = (ctx: Context) => {
  ctx.response.body = `data: ${ctx.request.headers.get("accept")}\n`;
};
