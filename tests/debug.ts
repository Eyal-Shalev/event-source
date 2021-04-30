import { EventSource } from "../mod.ts";
import { listener, port } from "./resources/mod.ts";
import { waitGroup } from "../_utils.ts";

// const wg = waitGroup();
// wg.add(1);

console.log(`http://localhost:${port}/resources/message2.ts`);
const source = new EventSource(
  `http://localhost:${port}/resources/message2.ts`,
);

// source.onopen = (e) => console.debug(e);
source.onmessage = (e) => console.info(e);
// source.onerror = (e) => console.error(e);

await listener;
