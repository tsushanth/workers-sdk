import type { OAuthFlowLogger } from "../context";

/**
 * Resolved credential-storage configuration captured by `createOAuthFlow`
 * and consulted on every read/write/delete by the resolver.
 *
 * Module-level state is awkward but justified: the free-function shape of
 * {@link writeAuthConfigFile} / {@link readAuthConfigFile} /
 * {@link deleteAuthConfig} predates the OAuth-flow extraction and is
 * relied on by both `flow.ts` and consumer tests. Threading the config
 * through every call site would balloon the diff; making `createOAuthFlow`
 * the single configurator keeps the call sites unchanged while still
 * letting consumers control all the knobs.
 */
export interface CredentialStorageState {
	serviceName: string;
	isKeyringEnabled: () => boolean;
	logger: OAuthFlowLogger;
	isNonInteractiveOrCI: () => boolean;
	cliName: string;
}

let currentState: CredentialStorageState | undefined;

/**
 * Per-session memoization flags used by the resolver to ensure warnings
 * fire once and the Windows lazy-install isn't retried after a failure.
 */
export interface ResolverSessionFlags {
	installFailedThisSession: boolean;
	hasWarnedAboutKeyringFallback: boolean;
	hasWarnedAboutSecretToolMissing: boolean;
}

const sessionFlags: ResolverSessionFlags = {
	installFailedThisSession: false,
	hasWarnedAboutKeyringFallback: false,
	hasWarnedAboutSecretToolMissing: false,
};

/**
 * Install the credential-storage configuration. Called once by
 * `createOAuthFlow` after validating the {@link OAuthFlowContext}'s
 * `credentialStorage` block.
 *
 * Subsequent calls overwrite the previous configuration — the last
 * `createOAuthFlow` wins. In practice there is only one OAuth flow per
 * process, but `resetCredentialStorageState` is exported for tests that
 * want a fully clean slate.
 */
export function setCredentialStorageState(state: CredentialStorageState): void {
	currentState = state;
}

/**
 * Return the active credential-storage configuration, or `undefined` when
 * `createOAuthFlow` hasn't been called yet.
 *
 * Callers that hit this `undefined` branch typically default to file-only
 * behavior — the legacy plaintext path that workers-auth shipped with
 * before the keyring extension landed.
 */
export function getCredentialStorageState():
	| CredentialStorageState
	| undefined {
	return currentState;
}

/** Mutable view onto the per-session resolver flags. */
export function getResolverSessionFlags(): ResolverSessionFlags {
	return sessionFlags;
}

/**
 * Reset module-level per-session resolver flags (memoized warnings, the
 * Windows install-failed latch).
 *
 * This is the function consumers and most tests want: it clears the
 * "we've already warned about X" / "the install failed earlier" memoization
 * without disturbing the credential-storage configuration that
 * `createOAuthFlow` established at module load.
 *
 * For tests that want to fully tear down the configuration (e.g. workers-auth
 * resolver tests that explicitly call `setCredentialStorageState`), see
 * {@link clearCredentialStorageState}.
 */
export function resetCredentialStorageState(): void {
	sessionFlags.installFailedThisSession = false;
	sessionFlags.hasWarnedAboutKeyringFallback = false;
	sessionFlags.hasWarnedAboutSecretToolMissing = false;
}

/**
 * Fully tear down the credential-storage configuration AND the session
 * flags. Intended for workers-auth's own resolver tests, which set the
 * configuration explicitly per-test via `setCredentialStorageState` rather
 * than via `createOAuthFlow`.
 *
 * Calling this in a wrangler test would leave the resolver without a
 * configuration and force it back to file-only behavior, defeating any
 * subsequent `--use-keyring` flow. Prefer `resetCredentialStorageState`
 * unless you specifically need to clear the configuration.
 */
export function clearCredentialStorageState(): void {
	currentState = undefined;
	resetCredentialStorageState();
}
