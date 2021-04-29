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

export type EventListener<TEvent extends Event = Event> =
  | ((evt: TEvent) => void | Promise<void>)
  | { handleEvent(evt: TEvent): void | Promise<void> };

export class EventTarget<TEvent extends Event = Event> {
  #listeners: Record<string, EventListener<TEvent>[]> = {};
  addEventListener(type: string, listener: EventListener<TEvent>): void {
    this.#listeners[type] = this.#listeners[type] || [];
    this.#listeners[type].push(listener);
  }
  dispatchEvent(event: TEvent): boolean {
    const listeners = this.#listeners[event.type] || [];
    for (const listener of listeners) {
      if (typeof listener === "function") {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
    return false;
  }
  removeEventListener(type: string, listener: EventListener<TEvent>): void {
    this.#listeners[type] = (this.#listeners[type] || [])
      .filter((item) => item !== listener);
  }
}
