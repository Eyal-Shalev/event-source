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
export class EventSource extends EventTarget {
  #readyState = ReadyState.CONNETING;
  readonly url: URL;
  readonly [Symbol.toStringTag] = "EventSource";
  #abortController: AbortController;
  #reconnectionTime: number;
  #lastEventID = "";
  #withCredentials: boolean;

  constructor(url: string, options: EventSourceInit = {}) {
    super();

    this.url = new URL(url);
    this.#reconnectionTime = options.reconnectionTime || 1000;
    this.#withCredentials = options.withCredentials || false;

    // Cleanup on unload.
    globalThis.addEventListener("unload", () => this.close());

    // Start the request and update the #abortController.
    this.#abortController = this.startRequest();
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

      queueTask(() => this.announceConnection());

      return this.processResonse(response);
    }).catch((reason) => {
      console.error(reason);
      this.close();
    });

    return controller;
  }

  protected async processResonse(response: Response) {
    const body = response.body;
    if (!body) throw new Error("missing body");

    const reader = body.getReader();

    // REVIEW: Does response.url count as "the serialization of the origin of the event stream's final URL (i.e., the URL after redirects)"?
    await this.interpretLines(this.readerToLines(reader), response.url);

    this.reestablishConnection();
    // this.close();
  }

  protected async *readerToLines(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): AsyncGenerator<string> {
    let lastBuffer = new Uint8Array(0);

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        return;
      }

      if (!value) {
        throw new Error("empty chuck");
      }

      const buffer = new Uint8Array(lastBuffer.length + value.length);
      buffer.set(lastBuffer);
      buffer.set(value);

      let index = 0, lastIndex = 0;
      for (; buffer.length > index; index++) {
        if (buffer[index] === lf || buffer[index] === cr) {
          // Decode the line and increment lastIndex to the current index (plus 1 to ignore the line separator)
          yield decoder.decode(buffer.slice(lastIndex, index));
          lastIndex = index + 1;
        }
      }
      lastBuffer = buffer.slice(lastIndex, index);
    }
  }

  protected async interpretLines(
    lines: AsyncGenerator<string>,
    origin: string,
  ): Promise<void> {
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
  }

  public close(): void {
    const err = new Error("Connection Closed"); // Declared above for stack tracing.
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
  protected announceConnection() {
    if (this.readyState !== ReadyState.CLOSED) {
      this.#readyState = ReadyState.OPEN;
    }
    this.dispatchEvent(new OpenEvent());
  }

  /**
   * @see {@link https://html.spec.whatwg.org/multipage/server-sent-events.html#reestablish-the-connection}
   */
  protected async reestablishConnection() {
    const err = new Error("Reconnecting"); // Declared above for stack tracing.
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
  }

  #backoffCounter = 1;

  /**
   * Calculates the time to wait for reconnecting to the server using exponential backoff
   */
  get reconnectionBackoff(): number {
    let delay = this.#reconnectionTime / 1000;
    delay = Math.pow(delay, this.#backoffCounter);
    delay = delay * 1000;
    return Math.abs(delay);
  }

  protected get headers(): HeadersInit {
    const ret: HeadersInit = {
      "Accept": "text/event-stream",
    };
    if (this.#lastEventID !== "") ret["Last-Event-ID"] = this.#lastEventID;
    return ret;
  }

  get corsAttributeState() {
    return this.#withCredentials ? "use-credentials" : "anonymous";
  }

  get fetchCredentials() {
    return this.#withCredentials ? "include" : "same-origin";
  }

  get readyState(): ReadyState {
    return this.#readyState;
  }

  #listeners: Record<string, EventListenerOrEventListenerObject[]> = {
    error: [],
    open: [],
    message: [],
  };

  public onopen?: EventListenerOrEventListenerObject;
  public onmessage?: EventListenerOrEventListenerObject;
  public onerror?: EventListenerOrEventListenerObject;

  /**
   * Appends an event listener for events whose type attribute response is type.
   * The callback argument sets the callback that will be invoked when the event
   * is dispatched.
   */
   public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.#listeners[type] = this.#listeners[type] || [];
    this.#listeners[type].push(listener);
  }

  /**
   * Dispatches a synthetic event event to target and returns true if either
   * event's cancelable attribute response is false or its preventDefault() method
   * was not invoked, and false otherwise.
   */
   public dispatchEvent(event: Event): boolean {
    let extra = this.onmessage;
    if (event.type === "open") extra = this.onopen;
    if (event.type === "error") extra = this.onerror;
    let listeners = (this.#listeners[event.type] || []).slice();
    if (extra) listeners = [extra, ...listeners];
    for (const listener of listeners) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }

    return false;
  }

  /**
   * Removes the event listener in target's event listener list with the same
   * type, callback, and options.
   */
   public removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject,
  ): void {
    this.#listeners[type] = this.#listeners[type]
      .filter((item) => item !== callback);
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

abstract class BaseEvent extends Event {
  // TODO: How should cancelable events be handled?
  readonly cancelable = false;
}

export class OpenEvent extends BaseEvent {
  constructor(options?: EventInit) {
    super("open", options);
  }

  toString(): string {
    return "Open";
  }
}

export class ErrorEvent extends BaseEvent {
  constructor(public readonly err?: Error | string, options?: EventInit) {
    super("error", options);
  }

  toString(): string {
    if (typeof this.err === "string") return `Error: ${this.err}`;
    return this.err?.stack || this.err?.message || "Error";
  }
}

export class MessageEvent extends BaseEvent {
  constructor(
    eventType: string,
    public readonly data: string,
    public readonly origin: string,
    public readonly lastEventID?: string,
    options?: EventInit,
  ) {
    super(eventType === "" ? "message" : eventType, options);
  }

  get [Symbol.toStringTag](): string {
    return `${this.constructor.name}(${this.type})`;
  }

  toString(): string {
    return `${this[Symbol.toStringTag]}: ${
      JSON.stringify(
        {
          event: this.type,
          data: this.data,
          origin: this.origin,
          lastEventID: this.lastEventID,
        },
        null,
        "  ",
      )
    }`;
  }
}

/**
 * @param {number} delay In milliseconds
 * @returns {Promise<void>} Resolves after {delay} milliseconds
 */
function sleep(delay?: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), delay);
  });
}

/**
 * @see {@link https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/}
 * @see {@link https://html.spec.whatwg.org/multipage/webappapis.html#queue-a-task}
 * @param {() => void} task 
 * @param {number} [delay=0]
 */
function queueTask(task: () => void, delay = 0): void {
  setTimeout(task, delay);
}

/**
 * @see {@link https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/}
 * @see {@link https://html.spec.whatwg.org/multipage/webappapis.html#queue-a-task}
 * @type T
 * @param {() => T} microtask 
 * @returns {Promise<T>}
 */
function queueMicrotask<T>(microtask: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      resolve(microtask());
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Line Feed Unicode
 * @see {@link EventSource#processResonse}
 */
const lf = "\n".charCodeAt(0);

/**
  * Caridge Return Unicode
  * @see {@link EventSource#processResonse}
  */
const cr = "\r".charCodeAt(0);
