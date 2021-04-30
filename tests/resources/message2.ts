import { Context } from "https://deno.land/x/oak@v7.3.0/mod.ts";
import { queueTask, sleep } from "../../_utils.ts";

export const handler = (ctx: Context) => {
  ctx.response.headers.set("Content-Type", "text/event-stream");
  ctx.response.headers.set("Cache-Control", "no-cache");

  const signal: AbortSignal = ctx.app.state["signal"];

  ctx.response.body = async function* () {
    while (!signal.aborted) {
      yield "data:msg";
      yield "\n";
      yield "data: msg";
      yield "\n\n";

      yield ":";
      yield "\n";

      yield "falsefield:msg";
      yield "\n\n";

      yield "falsefield:msg";
      yield "\n";

      yield "Data:data";
      yield "\n\n";

      yield "data";
      yield "\n\n";

      yield "data:end";
      yield "\n\n";

      await sleep(2000);
    }
  };
};
