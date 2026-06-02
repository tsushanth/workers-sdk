import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	getCloudflareApiEnvironmentFromEnv,
	getGlobalWranglerConfigPath,
	parseTOML,
	readFileSync,
} from "@cloudflare/workers-utils";
import TOML from "smol-toml";
import type { UserAuthConfig } from "../auth-config-file";
import type { CredentialStore } from "./interface";

/**
 * Subdirectory under the global config path where auth files live.
 */
const USER_AUTH_CONFIG_PATH = "config";

/**
 * Absolute path to the plaintext TOML credentials file for the active
 * Cloudflare API environment.
 *
 * The environment is appended to the filename so callers running with
 * `WRANGLER_API_ENVIRONMENT=staging` get a separate file from production.
 * The path stays exposed so the migration code, defensive scrubs on
 * logout, and tests that assert against it can all point at the same
 * location as the {@link FileCredentialStore}.
 */
export function getAuthConfigFilePath(): string {
	const environment = getCloudflareApiEnvironmentFromEnv();
	const fileName =
		environment === "production" ? "default.toml" : `${environment}.toml`;
	return path.join(
		getGlobalWranglerConfigPath(),
		USER_AUTH_CONFIG_PATH,
		fileName
	);
}

/**
 * The historical plaintext-TOML credentials store.
 *
 * Used as the default backend when the user hasn't opted into keyring
 * storage, and as the soft-fallback when keyring storage is requested
 * but a backend isn't available.
 */
export class FileCredentialStore implements CredentialStore {
	readonly kind = "file" as const;

	read(): UserAuthConfig | undefined {
		const filePath = getAuthConfigFilePath();
		if (!existsSync(filePath)) {
			return undefined;
		}
		try {
			return parseTOML(readFileSync(filePath)) as UserAuthConfig;
		} catch {
			// Corrupted file — treat as "no credentials stored". The
			// historical caller (`readStoredAuthState`) also tolerated parse
			// failures via try/catch; returning `undefined` here matches.
			return undefined;
		}
	}

	write(config: UserAuthConfig): void {
		const filePath = getAuthConfigFilePath();
		mkdirSync(path.dirname(filePath), { recursive: true });
		writeFileSync(filePath, TOML.stringify(config), { encoding: "utf-8" });
	}

	delete(): void {
		const filePath = getAuthConfigFilePath();
		if (existsSync(filePath)) {
			rmSync(filePath);
		}
	}

	describe(): string {
		return getAuthConfigFilePath();
	}
}
