import * as flags from "https://deno.land/std@0.95.0/flags/mod.ts";
import * as path from "https://deno.land/std@0.95.0/path/mod.ts";
import {
  Application,
  Middleware,
  Router,
  Status,
} from "https://deno.land/x/oak@v7.3.0/mod.ts";

let debug = false;
export const setDebug = (state = true) => {
  debug = state;
};
export const start = async (
  ...resources: string[]
): Promise<[number, Promise<unknown>, AbortController]> => {
  const args = flags.parse(Deno.args, {
    alias: { "port": "p" },
  });

  let port: number;
  if (args["port"] && typeof args["port"] === "number") {
    port = args["port"];
  } else {
    port = await Deno.permissions.query({ name: "env", variable: "PORT" })
      .then(selectGranted)
      .then(() => Deno.env.get("PORT"))
      .then((port) => port ? port : Promise.reject())
      .then(parseInt)
      .catch(() => 49000 + Math.round(Math.random() * 1000));
  }

  await Deno.permissions.request({ name: "net", host: `0.0.0.0:${port}` })
    .then(selectGranted)
    .catch(fatal);

  const controller = new AbortController();
  const app = new Application({ state: { signal: controller.signal } });
  const router = new Router();

  const pwd = path.dirname(path.fromFileUrl(import.meta.url));

  for (const resource of resources) {
    const resourcePath = path.join(pwd, resource);
    const { handler }: { handler: Middleware } = await import(resourcePath);
    router.all(`/resources/${resource}`, handler);
  }

  app.use(router.routes());
  app.use(router.allowedMethods());

  app.use((ctx) => {
    ctx.response.status = Status.NotFound;
    ctx.response.type = "html";
    ctx.response.body = `<ul>${
      resources.map((resource) => `/resources/${resource}`).map((url) =>
        `<li><a href="${url}">${url}</a></li>`
      )
    }</ul>`;
  });

  globalThis.addEventListener("unload", () => controller.abort());

  if (debug) console.debug(`Started server at http://127.0.0.1:${port}`);
  controller.signal.addEventListener("abort", () => {
    if (debug) console.debug(`Server abort signal received.`);
  });

  return [
    port,
    app.listen({ port, signal: controller.signal }),
    controller,
  ];
};

function selectGranted(status: Deno.PermissionStatus) {
  return status.state === "granted"
    ? Promise.resolve(status)
    : Promise.reject(new Error(JSON.stringify(status)));
}

function fatal<T>(...data: unknown[]): T {
  if (data.length > 0) console.error(...data);
  Deno.exit(1);
}
