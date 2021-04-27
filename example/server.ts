import { createHttpError } from "https://deno.land/x/oak@v7.3.0/httpError.ts";
import {
  Application,
  Router,
  ServerSentEvent,
} from "https://deno.land/x/oak@v7.3.0/mod.ts";

const app = new Application();
const router = new Router();

const sleep = (delay: number) => (
  new Promise<void>((resolve) => {
    setTimeout(() => resolve(), delay);
  })
);

router.get("/sse", async (ctx) => {
  if (Math.random() < 0.5) {
    ctx.response.status = 204;
    return;
  }

  const target = ctx.sendEvents();
  for (let i = 0; i < 5; i++) {
    target.dispatchComment("ignore comments");
    target.dispatchMessage("Only Data");
    target.dispatchEvent(
      new ServerSentEvent("ignore me, keep id", "", { id: Math.random() }),
    );
    target.dispatchEvent(
      new ServerSentEvent(
        "no id",
        "only data.\nBut take ID from previous event",
      ),
    );
    target.dispatchEvent(
      new ServerSentEvent("full event", "event + data + id", {
        id: Math.random(),
      }),
    );
    await sleep(500);
  }
  target.close();
});

app.use(router.routes());
await app.listen({ port: 4545 });
