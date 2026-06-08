# Integration testing Workers with `createTestHarness()`

This fixture is the complete runnable example linked from the `createTestHarness()` docs. It shows how to test a realistic multi-Worker app from a Node.js test runner.

The tests use Vitest as a regular Node.js test runner. They do not use `@cloudflare/vitest-pool-workers`.

## What this example covers

- Starting multiple Workers from Wrangler configuration files.
- Dispatching requests through configured routes with `server.fetch()`.
- Calling a specific Worker's `fetch()` handler directly with `server.getWorker(name)`.
- Triggering a specific Worker's `scheduled()` handler.
- Testing service bindings between Workers.
- Mocking outbound `fetch()` requests with MSW.
- Resetting local storage between tests with `server.reset()`.
- Testing Workers built by the Cloudflare Vite plugin.

## Example app

The app has two Workers:

| Worker       | Route               | Role                                                                          |
| ------------ | ------------------- | ----------------------------------------------------------------------------- |
| `web-worker` | `example.com/*`     | Handles user-facing routes and calls the API Worker over a service binding.   |
| `api-worker` | `example.com/api/*` | Fetches upstream user data, caches it in KV, and generates scheduled reports. |

## Start the harness

Point `createTestHarness()` at each Worker configuration file. The first Worker is the primary Worker.

```ts
const server = createTestHarness({
	workers: [
		{ configPath: "./wrangler.web.jsonc" },
		{ configPath: "./wrangler.api.jsonc" },
	],
});

const webWorker = server.getWorker("web-worker");
const apiWorker = server.getWorker("api-worker");
```

Start the server once for the test suite, reset it after each test, and close it when the suite finishes.

```ts
beforeAll(async () => {
	mock.listen({ onUnhandledRequest: "error" });
	await server.listen();
});

afterEach(async () => {
	mock.resetHandlers();
	await server.reset();
});

afterAll(async () => {
	mock.close();
	await server.close();
});
```

## Dispatch through routes

`server.fetch()` dispatches requests through the Workers' configured routes. In this example, API requests go to `api-worker`, while user-facing requests go to `web-worker`.

```ts
const apiResponse = await server.fetch("http://example.com/api/users/123");
expect(await apiResponse.json()).toEqual({ id: "123", name: "Ada" });

const webResponse = await server.fetch("http://example.com/users/123");
expect(await webResponse.text()).toBe("Profile: Ada");
```

## Call a Worker directly

Use `server.getWorker(name)` when a test should bypass route matching and dispatch directly to one Worker.

```ts
const userResponse = await apiWorker.fetch("http://example.com/api/users/123");
expect(await userResponse.json()).toEqual({ id: "123", name: "Ada" });
```

## Mock outbound requests

Workers started by `createTestHarness()` route outbound `fetch()` requests to the current Node.js process `globalThis.fetch()`. The tests use MSW to intercept requests to the upstream user API.

```ts
mock.use(
	http.get("http://upstream.example.com/users/:id", ({ params }) => {
		return HttpResponse.json({ id: params.id, name: "Ada" });
	})
);
```

## Trigger scheduled handlers

Use a Worker handle to trigger that Worker's `scheduled()` handler. This example seeds cached user data, runs the API Worker's daily report job, then verifies the report through the web Worker.

```ts
await apiWorker.fetch("http://example.com/api/users/123");
await apiWorker.fetch("http://example.com/api/users/456");

expect(
	await apiWorker.scheduled({
		cron: "0 0 * * *",
		scheduledTime: new Date("2026-05-29T00:00:00.000Z"),
	})
).toEqual({ outcome: "ok", noRetry: false });

const webResponse = await webWorker.fetch(
	"http://example.com/reports/2026-05-29"
);
expect(await webResponse.text()).toBe(
	"Daily report (2026-05-29): active users 123, 456"
);
```

## Vite projects

The Vite example builds each Worker to a generated Wrangler configuration file. Test those generated configs instead of the source configs passed to the Vite plugin.

```ts
const server = createTestHarness({
	workers: [
		{ configPath: "./dist/web_worker/wrangler.json" },
		{ configPath: "./dist/api_worker/wrangler.json" },
	],
});
```

## Run this example

From the Workers SDK repository root:

```sh
pnpm --filter @fixture/create-test-harness-example build
pnpm --filter @fixture/create-test-harness-example test:ci
```

## Files

| File                                                               | Purpose                                        |
| ------------------------------------------------------------------ | ---------------------------------------------- |
| [`tests/wrangler-project.test.ts`](tests/wrangler-project.test.ts) | Example for testing Wrangler projects.         |
| [`tests/vite-project.test.ts`](tests/vite-project.test.ts)         | Example for testing Vite projects.             |
| [`src/web.ts`](src/web.ts)                                         | User-facing Worker.                            |
| [`src/api.ts`](src/api.ts)                                         | API Worker with KV and scheduled job behavior. |
| [`wrangler.web.jsonc`](wrangler.web.jsonc)                         | Web Worker config.                             |
| [`wrangler.api.jsonc`](wrangler.api.jsonc)                         | API Worker config.                             |
| [`vite.config.ts`](vite.config.ts)                                 | Builds Vite-generated Worker configs.          |
