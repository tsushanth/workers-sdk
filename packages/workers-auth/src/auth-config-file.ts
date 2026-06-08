import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	getCloudflareApiEnvironmentFromEnv,
	getGlobalWranglerConfigPath,
	parseTOML,
	readFileSync,
	UserError,
} from "@cloudflare/workers-utils";
import TOML from "smol-toml";

/**
 * The data that may be read from the on-disk user auth config file.
 */
export interface UserAuthConfig {
	oauth_token?: string;
	refresh_token?: string;
	expiration_time?: string;
	scopes?: string[];
	/** @deprecated - this field was only provided by the deprecated v1 `wrangler config` command. */
	api_token?: string;
}

/**
 * The path to the config file that holds user authentication data,
 * relative to the user's home directory.
 */
const USER_AUTH_CONFIG_PATH = "config";

/**
 * Returns the absolute path to the auth config TOML file.
 *
 * The file lives under the global Wrangler config directory and is named
 * `default.toml` in production, or `<environment>.toml` for the staging /
 * other Cloudflare API environments.
 *
 * When a `profile` is provided, the file is named `<profile>.toml`. Non-default
 * profiles ignore the staging environment suffix — they always use
 * `<profile>.toml`.
 */
export function getAuthConfigFilePath(profile?: string): string {
	if (profile) {
		if (!/^[a-zA-Z0-9_-]+$/.test(profile)) {
			// always validate profile in order to prevent path traversa
			throw new UserError(
				`Invalid profile name "${profile}". Profile names may only contain alphanumeric characters, hyphens, and underscores.`,
				{ telemetryMessage: "auth profile invalid name" }
			);
		}
	}
	const resolved = profile ?? "default";
	let fileName: string;
	if (resolved === "default") {
		const environment = getCloudflareApiEnvironmentFromEnv();
		fileName =
			environment === "production" ? "default.toml" : `${environment}.toml`;
	} else {
		fileName = `${resolved}.toml`;
	}
	return path.join(
		getGlobalWranglerConfigPath(),
		USER_AUTH_CONFIG_PATH,
		fileName
	);
}

/**
 * Writes the user auth config to disk.
 *
 * No in-memory cache to invalidate — auth state is read on demand by every call
 * site that needs it. Callers are responsible for any consumer-side cache
 * purging (e.g. via the {@link OAuthFlowContext.purgeOnLoginOrLogout} hook).
 */
export function writeAuthConfigFile(
	config: UserAuthConfig,
	profile?: string
): void {
	const configPath = getAuthConfigFilePath(profile);

	mkdirSync(path.dirname(configPath), {
		recursive: true,
	});
	// Write with mode 0o600 on creation and re-`chmod` on every save so
	// other local users on shared hosts can't read the OAuth tokens.
	// `writeFileSync`'s `mode` option only applies when the file is
	// being created — the explicit `chmodSync` ensures that pre-existing
	// files (e.g. written by an older Wrangler version with the process
	// umask) get tightened on the next save too.
	writeFileSync(configPath, TOML.stringify(config), {
		encoding: "utf-8",
		mode: 0o600,
	});
	chmodSync(configPath, 0o600);
}

/**
 * Reads the user auth config from disk.
 *
 * @throws if the file does not exist or cannot be parsed as TOML. Callers
 * typically catch this and treat the failure as "not logged in via local OAuth".
 */
export function readAuthConfigFile(profile?: string): UserAuthConfig {
	return parseTOML(
		readFileSync(getAuthConfigFilePath(profile))
	) as UserAuthConfig;
}
