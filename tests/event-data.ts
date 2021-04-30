import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.95.0/testing/asserts.ts";
import { EventSource, MessageEvent } from "../mod.ts";
import { start } from "./resources/mod.ts";
import { waitGroup } from "../_utils.ts";

Deno.test("EventSource: lines and data parsing", async () => {
  const [port, listener, controller] = await start("message2.ts");
  const wg = waitGroup();
  wg.add(1);

  console.log(`http://localhost:${port}/resources/message2.ts`);
  const source = new EventSource(
    `http://localhost:${port}/resources/message2.ts`,
    { reconnectionTime: 100 },
  );
  let counter = 0;

  source.onmessage = ((e: MessageEvent) => {
    if (counter === 0) {
      assertEquals(e.data, "msg\nmsg");
    } else if (counter === 1) {
      assertEquals(e.data, "");
    } else if (counter === 2) {
      assertEquals(e.data, "end");
      source.close();
      wg.done();
    } else {
      assert(false, "Shouldn't reach here");
    }
    counter++;
  });

  await wg.wait();
  controller.abort();
  await listener;
});
