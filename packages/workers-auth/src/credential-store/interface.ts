import type { UserAuthConfig } from "../auth-config-file";

/**
 * Pluggable backend for the persisted OAuth credentials.
 *
 * Concrete implementations:
 * - {@link FileCredentialStore} — the historical plaintext TOML file at
 *   `<globalWranglerConfigPath>/config/<env>.toml`. Used by default and as
 *   a fallback when keyring storage is unavailable.
 * - {@link EncryptedFileCredentialStore} — an AES-256-GCM-encrypted file at
 *   `<globalWranglerConfigPath>/config/<env>.enc`, with the encryption key
 *   stored in the OS keyring via a {@link KeyProvider}.
 *
 * The interface is synchronous so it can be plugged into existing
 * `writeAuthConfigFile`/`readAuthConfigFile` free-function call sites
 * without forcing every caller to become async. Under the hood, both
 * implementations use synchronous primitives (subprocess `spawnSync`,
 * `@napi-rs/keyring`'s sync `Entry` class, `node:crypto` sync APIs,
 * synchronous filesystem calls).
 */
export interface CredentialStore {
	readonly kind: "file" | "encrypted-file";

	/**
	 * Return the stored credentials, or `undefined` when nothing has been
	 * stored. Backends must not throw for the "no credentials" case — the
	 * historical contract for the file store is "no file → no credentials"
	 * and other backends mirror it.
	 */
	read(): UserAuthConfig | undefined;

	/** Persist the given credentials, overwriting any previous value. */
	write(config: UserAuthConfig): void;

	/** Remove the stored credentials. Idempotent — no-op when nothing is stored. */
	delete(): void;

	/**
	 * Human-readable description of where credentials are stored, suitable
	 * for consumers' `whoami`-style output.
	 */
	describe(): string;
}
