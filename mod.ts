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
  public readonly [Symbol.toStringTag] = "EventSource";
  public readonly withCredentials: boolean;
  public get url() {
    return this.#url;
  }

  get readyState(): ReadyState {
    return this.#readyState;
  }

  #readyState = ReadyState.CONNETING;
  #url: URL;
  #reconnectionTime: number;
  #lastEventID = "";
  readonly #controller = new AbortController();

  constructor(url: string, options: EventSourceInit = {}) {
    this.#url = new URL(url);
    this.#reconnectionTime = options.reconnectionTime || 1000;
    this.withCredentials = options.withCredentials || false;

    // Cleanup on unload.
    globalThis.addEventListener("unload", () => this.#abort());

    this.#controller = new AbortController();
    this.#connect();
  }

  #connect = async () => {
    const response = await fetch(this.#url, {
      mode: "cors",
      credentials: this.withCredentials ? "include" : "same-origin",
      cache: "no-store",
      signal: this.#controller.signal,
      headers: this.headers,
    });

    try {
      await this.#rejectInvalidResponse(response);
    } catch (e) {
      this.#abort(e);
      return;
    }

    queueTask(this.#announceConnection);

    await this.#processResonse(response);

    await this.#reconnect();
  };

  protected get headers(): HeadersInit {
    const ret: HeadersInit = {
      "Accept": "text/event-stream",
    };
    if (this.#lastEventID !== "") ret["Last-Event-ID"] = this.#lastEventID;
    return ret;
  }

  #rejectInvalidResponse = (response: Response): Promise<Response> => {
    if (response.status === 204) {
      // Close when HTTP 204 (No Content response code) is received.
      this.#abort();
      return Promise.reject(
        new Error(`${response.status}: ${response.statusText}`),
      );
    }
    if (!response.ok || response.status !== 200) {
      return Promise.reject(
        new Error(`${response.status}: ${response.statusText}`),
      );
    }

    const contentType = response.headers.get("Content-Type");
    if (contentType !== "text/event-stream") {
      return Promise.reject(
        `"Content-Type" header is ${contentType} and not "text/event-stream"`,
      );
    }

    return Promise.resolve(response);
  };

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

  #processResonse = async (response: Response) => {
    const body = response.body;
    if (!body) throw new Error("missing body");

    const reader = body.getReader();
    const cancelReader = () => reader.cancel();

    this.#controller.signal.addEventListener("abort", cancelReader);

    // REVIEW: Does response.#url count as "the serialization of the origin of the event stream's final URL (i.e., the URL after redirects)"?
    await this.#interpretLines(readerToLines(reader), response.url);

    this.#controller.signal.removeEventListener("abort", cancelReader);
  };

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
        // Ignore empty events.
        if (data === "") {
          eventType = "";
          continue;
        }

        // Replace the last line feed charcter (added when handling fields below)
        data = data.replace(/\n$/, "");

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
      if (firstColonPos > 0) {
        field = line.slice(0, firstColonPos);
        value = line.slice(firstColonPos + 1).replace(/^ /, "");
      }

      // Handle the different fields.
      if (field === "event") {
        eventType = value;
      } else if (field === "data") {
        data = data + value + "\n";
      } else if (field === "id") {
        // Ignore ids that contain NULL (\0).
        if (value.includes("\0")) continue;
        eventID = value;
      } else if (field === "retry") {
        // Only parse the retry field if all characters are ASCII digits.
        if (!/^[0-9]+$/.test(value)) continue;
        this.#reconnectionTime = parseInt(value);
      } else {
        // Ignore invalid fields.
      }
    }
  };

  /**
   * @see {@link https://html.spec.whatwg.org/multipage/server-sent-events.html#reestablish-the-connection}
   */
  #reconnect = async () => {
    // Declared here for stack tracing.
    const err = new Error("Reconnecting");
    const annoucement = queueMicrotask<void>(() => {
      if (this.readyState === ReadyState.CLOSED) {
        this.#abort();
        return;
      }
      this.#readyState = ReadyState.CONNETING;
      this.dispatchEvent(new ErrorEvent(err));
    });

    await sleep(this.#reconnectBackoff());

    await annoucement;

    queueTask(() => {
      if (this.readyState !== ReadyState.CONNETING) return;

      this.#connect();
    });
  };

  #abort = (err?: Error | string) => {
    err = err || new Error("Connection Closed");
    queueTask(() => {
      this.#controller?.abort();
      if (this.readyState !== ReadyState.CLOSED) {
        this.dispatchEvent(new ErrorEvent(err));
      }
      this.#readyState = ReadyState.CLOSED;
    });
  };

  public close(): void {
    this.#abort();
  }

  /**
   * Calculates the time to wait for reconnecting to the server using exponential #reconnectBackoff
   */
  #reconnectBackoff = (): number => {
    let delay = this.#reconnectionTime / 1000;
    delay = Math.pow(delay, this.#backoffCounter);
    delay = delay * 1000;
    return Math.abs(delay);
  };
  #backoffCounter = 1;

  #messageEventTarget = new EventTarget<MessageEvent>();
  public onmessage?: EventListener<MessageEvent>;

  #errorEventTarget = new EventTarget<ErrorEvent>();
  public onerror?: EventListener<ErrorEvent>;

  #openEventTarget = new EventTarget<OpenEvent>();
  public onopen?: EventListener<OpenEvent>;

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
    if (event instanceof OpenEvent) {
      if (typeof this.onopen === "function") this.onopen(event);
      else if (this.onopen) this.onopen.handleEvent(event);
      return this.#openEventTarget.dispatchEvent(event);
    }
    if (event instanceof ErrorEvent) {
      if (typeof this.onerror === "function") this.onerror(event);
      else if (this.onerror) this.onerror.handleEvent(event);
      return this.#errorEventTarget.dispatchEvent(event);
    }
    if (typeof this.onmessage === "function") this.onmessage(event);
    else if (this.onmessage) this.onmessage.handleEvent(event);
    return this.#messageEventTarget.dispatchEvent(event);
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
