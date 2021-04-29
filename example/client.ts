import { EventSource, ReadyState } from "../mod.ts";

const events = new EventSource("http://localhost:8888/message2.ts");

// events.onopen = (event) => console.debug(event.toString());
events.onmessage = (event) => console.info(event);
// events.onerror = (event) => console.error(event.toString());

const sleep = (delay: number) => (
  new Promise<void>((resolve) => {
    setTimeout(() => resolve(), delay);
  })
);

while (events.readyState !== ReadyState.CLOSED) {
  await sleep(500);
}
