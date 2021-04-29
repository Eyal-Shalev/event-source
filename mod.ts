import { queueMicrotask, queueTask, readerToLines, sleep } from "./_utils.ts";
import { ErrorEvent, EventTarget, MessageEvent, OpenEvent } from "./event.ts";
import type { EventListener } from "./event.ts";
export { ErrorEvent, MessageEvent, OpenEvent };

export interface EventSourceInit {
  withCredentials?: boolean;
  reconnectionTime?: number;
}

/**
 * The EventSource interface is web content's interface to server-sent events.
 * An EventSource instance opens a persistent connection to an HTTP server, which sends events in text/event-stream format.
 * The connection remains open until closed by calling EventSource.close().
 *
 * Once the connection is opened, incoming messages from the server are delivered to your code in the form of events.
 * If there is an event field in the incoming message, the triggered event is the same as the event field value.
 * If no event field is present, then a generic message event is fired.
 *
 * Unlike WebSockets, server-sent events are unidirectional; that is, data messages are delivered in one direction,
 * from the server to the client (such as a user's web browser). That makes them an excellent choice when there's no need
 * to send data from the client to the server in message form. For example, EventSource is a useful approach for handling
 * things like social media status updates, news feeds, or delivering data into a client-side storage mechanism like
 * IndexedDB or web storage.
 * 
 * @see {@link https://html.spec.whatwg.org/multipage/server-sent-events.html}
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/EventSource}
 */
export class EventSource {
  #readyState = ReadyState.CONNETING;
  readonly url: URL;
  readonly [Symbol.toStringTag] = "EventSource";
  #abortController: AbortController;
  #reconnectionTime: number;
  #lastEventID = "";
  #withCredentials: boolean;

  constructor(url: string, options: EventSourceInit = {}) {
    this.url = new URL(url);
    this.#reconnectionTime = options.reconnectionTime || 1000;
    this.#withCredentials = options.withCredentials || false;

    // Cleanup on unload.
    globalThis.addEventListener("unload", () => this.close());

    // Start the request and update the #abortController.
    this.#abortController = this.startRequest();
  }

  get fetchCredentials() {
    return this.#withCredentials ? "include" : "same-origin";
  }

  protected startRequest(): AbortController {
    const controller = new AbortController();

    fetch(this.url, {
      mode: "cors",
      credentials: this.fetchCredentials,
      cache: "no-store",
      signal: controller.signal,
      headers: this.headers,
    }).then((response) => {
      if (response.status === 204) {
        // Close when HTTP 204 (No Content response code) is received.
        this.close();
        return;
      }
      if (!response.ok || response.status !== 200) {
        return Promise.reject(`${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("Content-Type");
      if (contentType !== "text/event-stream") {
        return Promise.reject(
          `"Content-Type" header is ${contentType} and not "text/event-stream"`,
        );
      }

      queueTask(() => this.#announceConnection());

      return this.processResonse(response);
    }).catch((reason) => {
      console.error(reason);
      this.close();
    });

    return controller;
  }

  protected get headers(): HeadersInit {
    const ret: HeadersInit = {
      "Accept": "text/event-stream",
    };
    if (this.#lastEventID !== "") ret["Last-Event-ID"] = this.#lastEventID;
    return ret;
  }

  protected async processResonse(response: Response) {
    const body = response.body;
    if (!body) throw new Error("missing body");

    const reader = body.getReader();

    // REVIEW: Does response.url count as "the serialization of the origin of the event stream's final URL (i.e., the URL after redirects)"?
    await this.#interpretLines(readerToLines(reader), response.url);

    this.#reestablishConnection();
  }

  #interpretLines = async (
    lines: AsyncGenerator<string>,
    origin: string,
  ): Promise<void> => {
    let eventID: string | undefined;
    let eventType = "";
    let data = "";

    for await (const line of lines) {
      // An empty line indicates the end of current event.
      if (line === "") {
        // Replace the last line feed charcter (added when handling fields below)
        data = data.replace(/\n$/, "");

        // Ignore empty events.
        if (data === "") {
          eventType = "";
          continue;
        }

        // Update the lastEventID if one was sent.
        if (eventID) this.#lastEventID = eventID;

        // Construct the MessageEvent and reset the event fields.
        const event = new MessageEvent(
          eventType,
          data,
          origin,
          this.#lastEventID,
        );
        data = eventType = "";

        // Dispatch the event in a queued-task and continue to next line.
        queueTask(() => {
          if (this.readyState === ReadyState.CLOSED) return;
          this.dispatchEvent(event);
        });
        continue;
      }

      const firstColonPos = line.indexOf(":");

      // Ignore comments
      if (firstColonPos === 0) continue;

      let field = line;
      let value = "";

      // Split the field from the value
      if (firstColonPos > -1) {
        field = line.slice(0, firstColonPos);
        value = line.slice(firstColonPos + 1).replace(/^ /, "");
      }

      // Handle the different fields.
      switch (field) {
        case "event":
          eventType = value;
          break;
        case "data":
          data = data + value + "\n";
          break;
        case "id":
          // Ignore ids that contain NULL (\0).
          if (value.includes("\0")) continue;
          eventID = value;
          break;
        case "retry":
          // Only parse the retry field if all characters are ASCII digits.
          if (!/^[0-9]+$/.test(value)) continue;
          this.#reconnectionTime = parseInt(value);
      }
    }
  };

  public close(): void {
    // Declared here for stack tracing.
    const err = new Error("Connection Closed");
    queueTask(() => {
      this.#abortController.abort();
      if (this.readyState !== ReadyState.CLOSED) {
        this.dispatchEvent(new ErrorEvent(err));
      }
      this.#readyState = ReadyState.CLOSED;
    });
  }

  /**
   * Annouce the connection.
   * This is done using setTimeout as a means to "queue a task"
   * @see {@link https://html.spec.whatwg.org/multipage/server-sent-events.html#sse-processing-model}
   */
  #announceConnection = () => {
    if (this.readyState !== ReadyState.CLOSED) {
      this.#readyState = ReadyState.OPEN;
    }
    this.dispatchEvent(new OpenEvent());
  };

  /**
   * @see {@link https://html.spec.whatwg.org/multipage/server-sent-events.html#reestablish-the-connection}
   */
  #reestablishConnection = async () => {
    // Declared here for stack tracing.
    const err = new Error("Reconnecting");
    const annoucement = queueMicrotask(() => {
      if (this.readyState === ReadyState.CLOSED) {
        this.close();
        throw new Error("Connection closed");
      }
      this.#readyState = ReadyState.CONNETING;
      this.dispatchEvent(new ErrorEvent(err));
    });

    await sleep(this.reconnectionBackoff);

    await annoucement;

    await queueMicrotask(() => {
      if (this.readyState !== ReadyState.CONNETING) return;
      this.#abortController = this.startRequest();
    });
  };

  /**
   * Calculates the time to wait for reconnecting to the server using exponential backoff
   */
  get reconnectionBackoff(): number {
    let delay = this.#reconnectionTime / 1000;
    delay = Math.pow(delay, this.#backoffCounter);
    delay = delay * 1000;
    return Math.abs(delay);
  }
  #backoffCounter = 1;

  get readyState(): ReadyState {
    return this.#readyState;
  }

  #messageEventTarget = new EventTarget<MessageEvent>();
  #onmessageListener?: EventListener<MessageEvent>;
  set onmessage(listener: EventListener<MessageEvent>) {
    if (this.#onmessageListener) {
      this.#messageEventTarget.removeEventListener(
        "message",
        this.#onmessageListener,
      );
    }
    this.#onmessageListener = listener;
    this.#messageEventTarget.addEventListener("message", listener);
  }

  #errorEventTarget = new EventTarget<ErrorEvent>();
  #onerrorListener?: EventListener<ErrorEvent>;
  set onerror(listener: EventListener<ErrorEvent>) {
    if (this.#onerrorListener) {
      this.#errorEventTarget.removeEventListener(
        "error",
        this.#onerrorListener,
      );
    }
    this.#onerrorListener = listener;
    this.#errorEventTarget.addEventListener("error", listener);
  }

  #openEventTarget = new EventTarget<OpenEvent>();
  #onopenListener?: EventListener<OpenEvent>;
  set onopen(listener: EventListener<OpenEvent>) {
    if (this.#onopenListener) {
      this.#openEventTarget.removeEventListener(
        "open",
        this.#onopenListener,
      );
    }
    this.#onopenListener = listener;
    this.#openEventTarget.addEventListener("open", listener);
  }

  addEventListener(type: "open", listener: EventListener<OpenEvent>): void;
  addEventListener(type: "error", listener: EventListener<ErrorEvent>): void;
  addEventListener(type: string, listener: EventListener<MessageEvent>): void;
  addEventListener(
    type: string,
    listener: EventListener<OpenEvent | MessageEvent | ErrorEvent>,
  ): void {
    switch (type) {
      case "open":
        return this.#openEventTarget.addEventListener(type, listener);
      case "error":
        return this.#errorEventTarget.addEventListener(type, listener);
      default:
        return this.#messageEventTarget.addEventListener(type, listener);
    }
  }
  dispatchEvent(event: OpenEvent | MessageEvent | ErrorEvent): boolean {
    switch (event.type) {
      case "open":
        return this.#openEventTarget.dispatchEvent(event);
      case "error":
        return this.#errorEventTarget.dispatchEvent(event);
      default:
        return this.#messageEventTarget.dispatchEvent(event as MessageEvent);
    }
  }
  removeEventListener(
    type: string,
    listener: EventListener<OpenEvent | MessageEvent | ErrorEvent>,
  ): void {
    switch (type) {
      case "open":
        return this.#openEventTarget.removeEventListener(type, listener);
      case "error":
        return this.#errorEventTarget.removeEventListener(type, listener);
      default:
        return this.#messageEventTarget.removeEventListener(type, listener);
    }
  }
}

export enum ReadyState {
  /**
   * The connection has not yet been established, or it was closed and the user agent is reconnecting.
   */
  CONNETING = 0,

  /**
   * The user agent has an open connection and is dispatching events as it receives them.
   */
  OPEN = 1,

  /**
   * The connection is not open, and the user agent is not trying to reconnect.
   * Either there was a fatal error or the close() method was invoked.
   */
  CLOSED = 2,
}
