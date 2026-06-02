/**
 * The data persisted by either the legacy plaintext TOML file or the
 * encrypted file backed by an OS-keyring-held key.
 *
 * Defined here (rather than colocated with `FileCredentialStore`) so
 * downstream consumers and tests that import `UserAuthConfig` keep the
 * same import path they had before the credential-store module landed.
 */
export interface UserAuthConfig {
	oauth_token?: string;
	refresh_token?: string;
	expiration_time?: string;
	scopes?: string[];
	/** @deprecated - this field was only provided by the deprecated v1 `wrangler config` command. */
	api_token?: string;
}

// `getAuthConfigFilePath`, the `FileCredentialStore` class, and the
// encrypted-file-related helpers live in the `credential-store` module.
// Re-export the file path helper here so existing callers
// (`flow.ts`, `state.ts`, consumer tests asserting against the legacy
// plaintext path) don't need to change their imports.
export { getAuthConfigFilePath } from "./credential-store/file-store";

import { getActiveCredentialStore } from "./credential-store/resolver";

/**
 * Persist the user auth config via the currently-active credential store.
 *
 * The store is resolved per-call so runtime changes to the consumer's
 * preferences (e.g. a user toggling `--use-keyring` mid-session) take
 * effect without rebuilding the OAuth flow.
 */
export function writeAuthConfigFile(config: UserAuthConfig): void {
	getActiveCredentialStore().write(config);
}

/**
 * Read the user auth config from the currently-active credential store.
 *
 * @throws when no credentials are stored. Matches the historical
 * "throws on missing file" semantics that callers already handle with
 * try/catch (see `readStoredAuthState`).
 */
export function readAuthConfigFile(): UserAuthConfig {
	const value = getActiveCredentialStore().read();
	if (value === undefined) {
		throw new Error("No credentials stored");
	}
	return value;
}

/**
 * Delete the persisted credentials via the currently-active store. Used
 * by the OAuth logout flow.
 */
export function deleteAuthConfig(): void {
	getActiveCredentialStore().delete();
}
