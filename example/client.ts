import { EventSource, ReadyState } from "../mod.ts";

const events = new EventSource("http://localhost:4545/sse");

events.onopen = (event) => console.debug(event.toString());
events.onmessage = (event) => console.info(event.toString());
events.onerror = (event) => console.error(event.toString());

const sleep = (delay: number) => (
  new Promise<void>((resolve) => {
    setTimeout(() => resolve(), delay);
  })
);

while (events.readyState !== ReadyState.CLOSED) {
  await sleep(500)
}