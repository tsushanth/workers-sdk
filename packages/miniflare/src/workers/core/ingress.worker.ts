import { WorkerEntrypoint } from "cloudflare:workers";
import { LogLevel, SharedHeaders } from "miniflare:shared";
import { CoreBindings, CoreHeaders, CorePaths } from "./constants";
import { handleEmail } from "./email";
import { handleScheduled } from "./scheduled";

type Env = {
	[CoreBindings.SERVICE_LOOPBACK]: Fetcher;
	[CoreBindings.SERVICE_INGRESS_FETCH_TARGET]: Fetcher;
	[CoreBindings.SERVICE_INGRESS_RPC_TARGET]: Fetcher | Service;
	[CoreBindings.TEXT_UPSTREAM_URL]?: string;
	[CoreBindings.TRIGGER_HANDLERS]: boolean;
};

function getUpstreamRequest(
	request: Request<unknown, IncomingRequestCfProperties>,
	env: Env,
	applyUpstream: boolean
) {
	// Only entry-routed requests apply `upstream`; internal service binding calls
	// still use ingress for default-entrypoint composition without changing origin.
	const upstreamUrl = env[CoreBindings.TEXT_UPSTREAM_URL];
	if (!applyUpstream || upstreamUrl === undefined) {
		return request;
	}

	let url = new URL(request.url);

	// Store the original hostname before it gets rewritten by upstream
	const originalHostname = url.host;

	// Resolves relative to `upstream`'s path
	url = new URL(`.${url.pathname}${url.search}`, upstreamUrl);
	request = new Request(url, request);
	request.headers.set("Host", url.host);
	request.headers.set(CoreHeaders.ORIGINAL_HOSTNAME, originalHostname);

	return request;
}

export default class IngressWorker extends WorkerEntrypoint<Env> {
	async fetch(request: Request<unknown, IncomingRequestCfProperties>) {
		const env = this.env;
		request = new Request(request);
		const applyUpstream = request.headers.get(CoreHeaders.APPLY_UPSTREAM) !== null;
		request.headers.delete(CoreHeaders.APPLY_UPSTREAM);
		const url = new URL(request.url);
		if (env[CoreBindings.TRIGGER_HANDLERS]) {
			if (
				url.pathname === CorePaths.SCHEDULED ||
				url.pathname === CorePaths.LEGACY_SCHEDULED
			) {
				if (url.pathname === CorePaths.LEGACY_SCHEDULED) {
					this.ctx.waitUntil(
						env[CoreBindings.SERVICE_LOOPBACK].fetch(
							"http://localhost/core/log",
							{
								method: "POST",
								headers: {
									[SharedHeaders.LOG_LEVEL]: LogLevel.WARN.toString(),
								},
								body: `Triggering scheduled handlers via a request to \`${CorePaths.LEGACY_SCHEDULED}\` is deprecated, and will be removed in a future version of Miniflare. Instead, send a request to \`${CorePaths.SCHEDULED}\``,
							}
						)
					);
				}

				return handleScheduled(
					url.searchParams,
					env[CoreBindings.SERVICE_INGRESS_RPC_TARGET]
				);
			}

			if (url.pathname === CorePaths.EMAIL) {
				return handleEmail(
					url.searchParams,
					request,
					env[CoreBindings.SERVICE_INGRESS_RPC_TARGET],
					env,
					this.ctx
				);
			}

			if (url.pathname.startsWith(CorePaths.HANDLER_PREFIX)) {
				return new Response(
					`"${url.pathname}" is not a valid handler. Did you mean to use "${CorePaths.SCHEDULED}" or "${CorePaths.EMAIL}"?`,
					{ status: 404 }
				);
			}
		}

		return env[CoreBindings.SERVICE_INGRESS_FETCH_TARGET].fetch(
			getUpstreamRequest(request, env, applyUpstream)
		);
	}

	constructor(ctx: ExecutionContext, env: Env) {
		super(ctx, env);

		return new Proxy(this, {
			get(target, prop) {
				if (Reflect.has(target, prop)) {
					return Reflect.get(target, prop);
				}

				return Reflect.get(
					target.env[CoreBindings.SERVICE_INGRESS_RPC_TARGET],
					prop
				);
			},
		});
	}
}
