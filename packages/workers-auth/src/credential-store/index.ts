// Public surface of the credential-store module.
//
// Consumers (wrangler) almost always interact with this module via the
// `OAuthFlowAPI.getCredentialStore()` accessor returned from
// `createOAuthFlow(...)`, which closes over the configuration the
// consumer passed in. Direct imports from here are useful for tests and
// for `whoami`-style code that wants to call `.describe()`.

export type { CredentialStore } from "./interface";
export type { UserAuthConfig } from "../auth-config-file";

export { FileCredentialStore, getAuthConfigFilePath } from "./file-store";

export {
	EncryptedFileCredentialStore,
	getEncryptedAuthConfigFilePath,
} from "./encrypted-file-store";

export { getActiveCredentialStore } from "./resolver";

export {
	clearCredentialStorageState,
	resetCredentialStorageState,
} from "./state";

export type { KeyProvider } from "./key-providers/interface";
export {
	getKeyringAccountName,
	encodeKeyEnvelope,
	decodeKeyEnvelope,
} from "./key-providers/shared";

export {
	MacSecurityKeyProvider,
	setMacSecurityCommandRunner,
} from "./key-providers/mac-security";
export type { MacSecurityCommandRunner } from "./key-providers/mac-security";

export {
	LinuxSecretToolKeyProvider,
	probeSecretTool,
	setLinuxSecretToolRunner,
} from "./key-providers/linux-secret-tool";
export type { LinuxSecretToolRunner } from "./key-providers/linux-secret-tool";

export { NapiKeyringKeyProvider } from "./key-providers/napi-keyring";

export {
	findKeyringBinding,
	getKeyringInstallDir,
	installKeyringBindingSync,
	PINNED_KEYRING_VERSION,
	setKeyringEntryFactory,
	setNpmRunner,
} from "./key-providers/lazy-installer";
export type {
	KeyringEntry,
	KeyringEntryFactory,
	NpmRunner,
} from "./key-providers/lazy-installer";

export {
	resolveKeyProvider,
	setKeyProviderFactoryForTesting,
} from "./key-providers/factory";
export type { KeyProviderResolution } from "./key-providers/factory";

export {
	encryptString,
	decryptString,
	generateKey,
	parseEncryptedEnvelope,
} from "./crypto";
export type { EncryptedEnvelope } from "./crypto";
