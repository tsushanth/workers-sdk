import { UserError } from "@cloudflare/workers-utils";
import { getCloudflareAuthUseKeyringFromEnv } from "../env-vars";
import { EncryptedFileCredentialStore } from "./encrypted-file-store";
import { FileCredentialStore } from "./file-store";
import { resolveKeyProvider } from "./key-providers/factory";
import { PINNED_KEYRING_VERSION } from "./key-providers/lazy-installer";
import { getCredentialStorageState, getResolverSessionFlags } from "./state";
import type { CredentialStore } from "./interface";

/**
 * Resolve the credential store that should service the next read/write.
 *
 * Selection order (highest precedence first):
 *   1. `CLOUDFLARE_AUTH_USE_KEYRING=false` env var — forces the file store.
 *   2. No consumer configuration installed — defaults to file store (this
 *      keeps workers-auth backward-compatible for the historical use of
 *      `writeAuthConfigFile`/`readAuthConfigFile` before any consumer has
 *      called `createOAuthFlow`).
 *   3. `CLOUDFLARE_AUTH_USE_KEYRING=true` env var — forces keyring storage;
 *      failures throw rather than soft-falling-back.
 *   4. `isKeyringEnabled()` callback (the consumer's persistent preference) —
 *      uses keyring storage; failures soft-fall-back with a one-time warning.
 *
 * The resolver re-reads the env var and the `isKeyringEnabled` callback
 * on every call so runtime preference changes take effect without
 * re-initializing the storage layer.
 */
export function getActiveCredentialStore(): CredentialStore {
	const envOverride = getCloudflareAuthUseKeyringFromEnv();
	const state = getCredentialStorageState();

	if (envOverride === false) {
		return new FileCredentialStore();
	}
	if (state === undefined) {
		// `createOAuthFlow` hasn't been called, or was called without the
		// `credentialStorage` block. Behave as workers-auth did before the
		// keyring extension — plaintext file only.
		return new FileCredentialStore();
	}

	const forced = envOverride === true;
	const wantsKeyring = envOverride ?? state.isKeyringEnabled() ?? false;

	if (!wantsKeyring) {
		return new FileCredentialStore();
	}

	const resolution = resolveKeyProvider(state.serviceName);

	switch (resolution.kind) {
		case "available":
			return new EncryptedFileCredentialStore(resolution.provider, (result) => {
				state.logger.log(
					`Migrated credentials from ${result.legacyPath} into ${result.encryptedPath} (key in ${result.keyProviderDescription}).`
				);
			});

		case "needs-install":
			return handleNeedsInstall(resolution, forced);

		case "unsupported":
			return handleUnsupported(forced);
	}
}

function handleNeedsInstall(
	resolution: Extract<
		ReturnType<typeof resolveKeyProvider>,
		{ kind: "needs-install" }
	>,
	forced: boolean
): CredentialStore {
	const state = getCredentialStorageState();
	if (state === undefined) {
		// Defensive: we should only reach the install path when state is
		// configured, but guard anyway.
		return new FileCredentialStore();
	}
	const flags = getResolverSessionFlags();

	if (flags.installFailedThisSession) {
		if (forced) {
			throw new UserError(
				`CLOUDFLARE_AUTH_USE_KEYRING is set but the keyring backend could not be installed earlier this session.`,
				{ telemetryMessage: "workers-auth keyring install previously failed" }
			);
		}
		return fallbackToFileWithWarning(
			`The keyring backend could not be installed earlier this session; using the plaintext credentials file.`
		);
	}

	if (state.isNonInteractiveOrCI()) {
		throw new UserError(windowsBindingMissingMessage(state.cliName), {
			telemetryMessage: "workers-auth keyring binding not installed",
		});
	}

	try {
		state.logger.log(`🔐 Installing keyring backend (one-time, ~2 MB)…`);
		resolution.install();
	} catch (e) {
		flags.installFailedThisSession = true;
		if (forced) {
			throw e instanceof UserError
				? e
				: new UserError(
						`Failed to install the keyring backend: ${e instanceof Error ? e.message : String(e)}`,
						{ telemetryMessage: "workers-auth keyring install threw" }
					);
		}
		return fallbackToFileWithWarning(
			`Failed to install the keyring backend (${e instanceof Error ? e.message : String(e)}); falling back to the plaintext credentials file.`
		);
	}

	return new EncryptedFileCredentialStore(
		resolution.afterInstall(),
		(result) => {
			state.logger.log(
				`Migrated credentials from ${result.legacyPath} into ${result.encryptedPath} (key in ${result.keyProviderDescription}).`
			);
		}
	);
}

function handleUnsupported(forced: boolean): CredentialStore {
	const state = getCredentialStorageState();
	const platform = process.platform;

	// Linux without `secret-tool` lands here. macOS and Windows have
	// keyring backends, so this branch covers Linux-missing-tool and
	// genuinely unsupported platforms (FreeBSD, etc.).
	const linuxMissingTool = platform === "linux";
	const message = linuxMissingTool
		? secretToolMissingMessage(state?.cliName ?? "your CLI")
		: `OS keyring storage is not supported on \`${platform}\`; falling back to the plaintext credentials file.`;

	if (forced) {
		throw new UserError(
			linuxMissingTool
				? `CLOUDFLARE_AUTH_USE_KEYRING is set but ${message}`
				: `CLOUDFLARE_AUTH_USE_KEYRING is set but no keyring backend is available on \`${platform}\`.`,
			{
				telemetryMessage: linuxMissingTool
					? "workers-auth keyring secret tool missing"
					: "workers-auth keyring unsupported platform",
			}
		);
	}

	if (linuxMissingTool && state?.isNonInteractiveOrCI()) {
		throw new UserError(message, {
			telemetryMessage: "workers-auth keyring secret tool missing",
		});
	}

	const flags = getResolverSessionFlags();
	if (linuxMissingTool) {
		if (!flags.hasWarnedAboutSecretToolMissing) {
			flags.hasWarnedAboutSecretToolMissing = true;
			state?.logger.warn(
				`${message}\n\nFalling back to the plaintext credentials file for this session.`
			);
		}
		return new FileCredentialStore();
	}

	return fallbackToFileWithWarning(message);
}

function fallbackToFileWithWarning(message: string): CredentialStore {
	const state = getCredentialStorageState();
	const flags = getResolverSessionFlags();
	if (!flags.hasWarnedAboutKeyringFallback) {
		flags.hasWarnedAboutKeyringFallback = true;
		state?.logger.warn(message);
	}
	return new FileCredentialStore();
}

function secretToolMissingMessage(cliName: string): string {
	return `\`secret-tool\` is required for OS keyring storage on Linux but is not installed.

Install it via your package manager:
  Debian/Ubuntu:  sudo apt-get install libsecret-tools
  Fedora/RHEL:    sudo dnf install libsecret
  Arch:           sudo pacman -S libsecret
  Alpine:         apk add libsecret

Or disable keyring storage: \`${cliName} login --no-use-keyring\`.`;
}

function windowsBindingMissingMessage(cliName: string): string {
	return `\`@napi-rs/keyring\` is required for OS keyring storage on Windows but is not installed.

Run \`${cliName} login --use-keyring\` interactively to install it automatically, or install it globally for CI:

  npm install -g @napi-rs/keyring@${PINNED_KEYRING_VERSION}

Or disable keyring storage: \`${cliName} login --no-use-keyring\`.`;
}
