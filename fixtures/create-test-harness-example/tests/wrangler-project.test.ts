import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, test } from "vitest";
import { createTestHarness } from "wrangler";

// Point each worker to the Wrangler config you want to test.
const server = createTestHarness({
	workers: [
		{ configPath: "./wrangler.web.jsonc" },
		{ configPath: "./wrangler.api.jsonc" },
	],
});

// server.getWorker() would return the first Worker, but naming it makes it explicit.
const webWorker = server.getWorker("web-worker");
const apiWorker = server.getWorker("api-worker");

// createTestHarness's route Workers outbound fetches to globalThis.fetch().
// You can use libraries like MSW to intercept those requests.
const mock = setupServer();

describe("createTestHarness: wrangler project setup", () => {
	beforeAll(async () => {
		mock.listen({ onUnhandledRequest: "error" });
		await server.listen();
	});

	afterAll(async () => {
		mock.close();
		await server.close();
	});

	afterEach(async () => {
		// Keep tests isolated while reusing the same running server.
		mock.resetHandlers();
		await server.reset();
	});

	test("fetches the primary Worker with a relative URL", async ({ expect }) => {
		// Relative URLs are dispatched to the primary Worker (the first one listed).
		const response = await server.fetch("/");
		expect(await response.text()).toBe("Hello World");
	});

	test("mocks outbound requests", async ({ expect }) => {
		mock.use(
			http.get("http://upstream.example.com/users/:id", ({ params }) => {
				return HttpResponse.json({ id: params.id, name: "Ada" });
			})
		);

		const userResponse = await apiWorker.fetch(
			"http://example.com/api/users/123"
		);
		expect(await userResponse.json()).toEqual({
			id: "123",
			name: "Ada",
		});
	});

	test("dispatches requests using configured routes", async ({ expect }) => {
		mock.use(
			http.get("http://upstream.example.com/users/:id", ({ params }) => {
				return HttpResponse.json({ id: params.id, name: "Ada" });
			})
		);

		// server.fetch() matches requests to workers based on routes.
		const apiResponse = await server.fetch("http://example.com/api/users/123");
		expect(await apiResponse.json()).toEqual({
			id: "123",
			name: "Ada",
		});

		const webResponse = await server.fetch("http://example.com/users/123");
		expect(await webResponse.text()).toBe("Profile: Ada");
	});

	test("runs scheduled jobs and stores the result", async ({ expect }) => {
		mock.use(
			http.get("http://upstream.example.com/users/:id", ({ params }) => {
				return HttpResponse.json({ id: params.id, name: "Ada" });
			})
		);

		// Seed user data that the scheduled job will read to generate a report.
		await apiWorker.fetch("http://example.com/api/users/123");
		await apiWorker.fetch("http://example.com/api/users/456");

		const initialResponse = await webWorker.fetch(
			"http://example.com/reports/2026-05-29"
		);
		expect(initialResponse.status).toBe(404);
		expect(await initialResponse.text()).toBe("No report");

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
	});
});
