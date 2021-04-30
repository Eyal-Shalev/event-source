export type WaitGroup = Readonly<{
  add: (delta: number) => void;
  done: () => void;
  wait: () => Promise<void>;
}>;
export function waitGroup(): WaitGroup {
  let counter = 0;
  const et = new EventTarget();

  return Object.freeze({ add, done, wait });

  function add(delta: number) {
    console.assert(
      Number.isSafeInteger(delta),
      { delta },
      "Delta must be a safe integer",
    );
    counter += delta;
    counter = Math.max(counter, 0);
    if (counter === 0) et.dispatchEvent(new Event("done"));
  }

  function done() {
    add(-1);
  }

  function wait() {
    if (counter === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      et.addEventListener("done", () => resolve());
    });
  }
}

/**
 * @param {number} delay In milliseconds
 * @returns {Promise<void>} Resolves after {delay} milliseconds
 */
export function sleep(delay?: number): Promise<void> {
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
export function queueTask(task: () => void, delay = 0): void {
  setTimeout(task, delay);
}

/**
 * @see {@link https://jakearchibald.com/2015/tasks-microtasks-queues-and-schedules/}
 * @see {@link https://html.spec.whatwg.org/multipage/webappapis.html#queue-a-task}
 * @type T
 * @param {() => T} microtask 
 * @returns {Promise<T>}
 */
export function queueMicrotask<T>(microtask: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      resolve(microtask());
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Takes a UTF-8 reader and returns an async generator that yields for each line
 * in the reader.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @returns {AsyncGenerator<string>}
 */
export async function* readerToLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let lastBuffer = new Uint8Array(0);
  while (true) {
    const { done, value } = await reader.read();

    if (done) return;
    if (!value) continue;

    // Append the new buffer to the last buffer, in case there was any unhandled characters there.
    const buffer = new Uint8Array(lastBuffer.length + value.length);
    buffer.set(lastBuffer);
    buffer.set(value, lastBuffer.length);

    let index = 0, lastIndex = 0;
    for (; index < buffer.length; index++) {
      // Continue if it's a normal character.
      if (![lf, cr, nil].includes(buffer[index])) continue;

      // Decode the and yield line
      yield decoder.decode(buffer.slice(lastIndex, index));

      // If the counter line ended with nil, then break from the loop.
      if (buffer[index] === nil) break;

      // increment lastIndex to the counter index (plus 1 to ignore the line separator)
      lastIndex = index + 1;
    }

    lastBuffer = buffer.slice(lastIndex);
  }
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

/**
  * NULL Unicode
  * @see {@link EventSource#processResonse}
  */
const nil = "\0".charCodeAt(0);
