// Public surface of @cloudflare/workers-auth.
//
// Consumers typically wire up a single `createOAuthFlow(ctx)` instance and
// then call its methods. The pure helpers exported here are useful when the
// consumer needs to read/write the auth state directly (e.g. wrangler's
// `getAPIToken` resolver), or to inject deterministic implementations into
// tests.

export {
	deleteAuthConfig,
	getAuthConfigFilePath,
	readAuthConfigFile,
	writeAuthConfigFile,
} from "./auth-config-file";
export type { UserAuthConfig } from "./auth-config-file";

export {
	clearAccessCaches,
	domainUsesAccess,
	getAccessHeaders,
	getCloudflareAccessHeaders,
} from "./access";

export type {
	CredentialStorageContext,
	OAuthFlowContext,
	OAuthFlowLogger,
} from "./context";

export {
	getAccessClientIdFromEnv,
	getAccessClientSecretFromEnv,
	getAuthDomainFromEnv,
	getAuthUrlFromEnv,
	getCfAuthorizationTokenFromEnv,
	getClientIdFromEnv,
	getCloudflareAuthUseKeyringFromEnv,
	getRevokeUrlFromEnv,
	getTokenUrlFromEnv,
} from "./env-vars";

export {
	ErrorAccessDenied,
	ErrorAccessTokenResponse,
	ErrorAuthenticationGrant,
	ErrorInvalidClient,
	ErrorInvalidGrant,
	ErrorInvalidJson,
	ErrorInvalidRequest,
	ErrorInvalidReturnedStateParam,
	ErrorInvalidScope,
	ErrorInvalidToken,
	ErrorNoAuthCode,
	ErrorOAuth2,
	ErrorServerError,
	ErrorTemporarilyUnavailable,
	ErrorUnauthorizedClient,
	ErrorUnknown,
	ErrorUnsupportedGrantType,
	ErrorUnsupportedResponseType,
	toErrorClass,
} from "./errors";

export { createOAuthFlow, OAUTH_CALLBACK_URL } from "./flow";
export type { LoginProps, OAuthFlowAPI } from "./flow";

export { generateAuthUrl } from "./generate-auth-url";

export { generateRandomState } from "./generate-random-state";

export {
	base64urlEncode,
	generatePKCECodes,
	PKCE_CHARSET,
	RECOMMENDED_CODE_VERIFIER_LENGTH,
	RECOMMENDED_STATE_LENGTH,
} from "./pkce";
export type { PKCECodes } from "./pkce";

export { readStoredAuthState } from "./state";
export type {
	AccessToken,
	OAuthFlowState,
	RefreshToken,
	StoredAuthState,
} from "./state";

// Credential storage layer. Consumers (wrangler, future Cloudflare CLIs)
// usually interact with this via `OAuthFlowAPI.getCredentialStore()`,
// but the underlying pieces are exported here for tests, `whoami`-style
// reporting, and the `--no-use-keyring` opt-out migration helper.
export {
	clearCredentialStorageState,
	EncryptedFileCredentialStore,
	FileCredentialStore,
	encryptString,
	decryptString,
	findKeyringBinding,
	generateKey,
	getActiveCredentialStore,
	getEncryptedAuthConfigFilePath,
	getKeyringAccountName,
	getKeyringInstallDir,
	installKeyringBindingSync,
	LinuxSecretToolKeyProvider,
	MacSecurityKeyProvider,
	NapiKeyringKeyProvider,
	parseEncryptedEnvelope,
	PINNED_KEYRING_VERSION,
	probeSecretTool,
	resetCredentialStorageState,
	resolveKeyProvider,
	setKeyProviderFactoryForTesting,
	setKeyringEntryFactory,
	setLinuxSecretToolRunner,
	setMacSecurityCommandRunner,
	setNpmRunner,
} from "./credential-store";
export type {
	CredentialStore,
	EncryptedEnvelope,
	KeyProvider,
	KeyProviderResolution,
	KeyringEntry,
	KeyringEntryFactory,
	LinuxSecretToolRunner,
	MacSecurityCommandRunner,
	NpmRunner,
} from "./credential-store";
