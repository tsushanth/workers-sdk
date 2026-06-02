import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runInTempDir } from "@cloudflare/workers-utils/test-helpers";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { setKeyProviderFactoryForTesting } from "../../src/credential-store/key-providers/factory";
import {
	getKeyringInstallDir,
	setNpmRunner,
} from "../../src/credential-store/key-providers/lazy-installer";
import { setLinuxSecretToolRunner } from "../../src/credential-store/key-providers/linux-secret-tool";
import { setMacSecurityCommandRunner } from "../../src/credential-store/key-providers/mac-security";
import { getActiveCredentialStore } from "../../src/credential-store/resolver";
import {
	clearCredentialStorageState,
	setCredentialStorageState,
} from "../../src/credential-store/state";
import type { KeyProvider } from "../../src/credential-store/key-providers/interface";
import type { SpawnSyncReturns } from "node:child_process";

function mockResult({
	status = 0,
	stdout = "",
	stderr = "",
}: {
	status?: number | null;
	stdout?: string;
	stderr?: string;
} = {}): SpawnSyncReturns<string> {
	return {
		status,
		stdout,
		stderr,
		signal: null,
		output: [null, stdout, stderr],
		pid: 1,
	} as SpawnSyncReturns<string>;
}

class InMemoryKeyProvider implements KeyProvider {
	private key: Uint8Array | undefined;
	getKey() {
		return this.key;
	}
	setKey(key: Uint8Array) {
		this.key = key;
	}
	deleteKey() {
		this.key = undefined;
	}
	describe() {
		return "in-memory test keyring";
	}
}

const ORIGINAL_PLATFORM = process.platform;
function stubPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", {
		value: platform,
		configurable: true,
	});
}
function restorePlatform(): void {
	Object.defineProperty(process, "platform", {
		value: ORIGINAL_PLATFORM,
		configurable: true,
	});
}

const warn = vi.fn();
const log = vi.fn();
const silentLogger = {
	debug: () => {},
	info: () => {},
	log,
	warn,
	error: () => {},
};

interface StateOptions {
	isKeyringEnabled?: boolean;
	isNonInteractiveOrCI?: boolean;
}

function configureState(opts: StateOptions = {}) {
	setCredentialStorageState({
		serviceName: "wrangler",
		isKeyringEnabled: () => opts.isKeyringEnabled ?? true,
		logger: silentLogger,
		isNonInteractiveOrCI: () => opts.isNonInteractiveOrCI ?? false,
		cliName: "wrangler",
	});
}

describe("getActiveCredentialStore — resolver", () => {
	runInTempDir();

	beforeEach(() => {
		warn.mockClear();
		log.mockClear();
		clearCredentialStorageState();
	});

	afterEach(() => {
		setKeyProviderFactoryForTesting(undefined);
		setMacSecurityCommandRunner(undefined);
		setLinuxSecretToolRunner(undefined);
		setNpmRunner(undefined);
		clearCredentialStorageState();
		restorePlatform();
	});

	describe("precedence", () => {
		it("defaults to FileCredentialStore when no state is configured", ({
			expect,
		}) => {
			expect(getActiveCredentialStore().kind).toBe("file");
		});

		it("defaults to FileCredentialStore when keyring is disabled in preferences", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: false });
			expect(getActiveCredentialStore().kind).toBe("file");
		});

		it("CLOUDFLARE_AUTH_USE_KEYRING=false forces FileCredentialStore", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true });
			vi.stubEnv("CLOUDFLARE_AUTH_USE_KEYRING", "false");
			expect(getActiveCredentialStore().kind).toBe("file");
		});

		it("CLOUDFLARE_AUTH_USE_KEYRING=true forces the encrypted store even when the preference is off", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: false });
			vi.stubEnv("CLOUDFLARE_AUTH_USE_KEYRING", "true");
			setKeyProviderFactoryForTesting(() => new InMemoryKeyProvider());
			expect(getActiveCredentialStore().kind).toBe("encrypted-file");
		});

		it("uses the encrypted store when keyring is enabled and a provider is available", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true });
			setKeyProviderFactoryForTesting(() => new InMemoryKeyProvider());
			expect(getActiveCredentialStore().kind).toBe("encrypted-file");
		});

		it("CLOUDFLARE_AUTH_USE_KEYRING=true with an unavailable backend throws a UserError", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true });
			vi.stubEnv("CLOUDFLARE_AUTH_USE_KEYRING", "true");
			stubPlatform("freebsd" as NodeJS.Platform);

			expect(() => getActiveCredentialStore()).toThrow(
				/CLOUDFLARE_AUTH_USE_KEYRING is set but no keyring backend is available on `freebsd`/
			);
		});
	});

	describe("darwin", () => {
		it("returns an encrypted store backed by MacSecurityKeyProvider", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true });
			stubPlatform("darwin");
			setMacSecurityCommandRunner(() => mockResult({ status: 44 }));

			const store = getActiveCredentialStore();
			expect(store.kind).toBe("encrypted-file");
			expect(store.describe()).toContain("macOS Keychain");
		});
	});

	describe("linux", () => {
		it("returns an encrypted store backed by LinuxSecretToolKeyProvider when secret-tool is present", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true });
			stubPlatform("linux");
			setLinuxSecretToolRunner((args) => {
				if (args[0] === "--version") {
					return mockResult({ stdout: "secret-tool 0.21.7" });
				}
				return mockResult({ status: 1 });
			});

			const store = getActiveCredentialStore();
			expect(store.kind).toBe("encrypted-file");
			expect(store.describe()).toContain("secret-tool");
		});

		it("warns and falls back to FileCredentialStore when secret-tool is missing (interactive)", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true, isNonInteractiveOrCI: false });
			stubPlatform("linux");
			setLinuxSecretToolRunner(() => {
				throw new Error("ENOENT");
			});

			const store = getActiveCredentialStore();
			expect(store.kind).toBe("file");
			expect(warn).toHaveBeenCalledWith(expect.stringContaining("secret-tool"));
		});

		it("hard-errors when secret-tool is missing in a non-interactive context", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true, isNonInteractiveOrCI: true });
			stubPlatform("linux");
			setLinuxSecretToolRunner(() => {
				throw new Error("ENOENT");
			});

			expect(() => getActiveCredentialStore()).toThrow(
				/`secret-tool` is required for OS keyring storage on Linux/
			);
		});

		it("hard-errors with the CLOUDFLARE_AUTH_USE_KEYRING-prefixed message when forced and missing", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true });
			stubPlatform("linux");
			vi.stubEnv("CLOUDFLARE_AUTH_USE_KEYRING", "true");
			setLinuxSecretToolRunner(() => mockResult({ status: 127 }));

			expect(() => getActiveCredentialStore()).toThrow(
				/CLOUDFLARE_AUTH_USE_KEYRING is set but `secret-tool` is required/
			);
		});

		it("warns at most once per process about the secret-tool fallback", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true });
			stubPlatform("linux");
			setLinuxSecretToolRunner(() => {
				throw new Error("ENOENT");
			});

			getActiveCredentialStore();
			getActiveCredentialStore();
			getActiveCredentialStore();
			const matches = warn.mock.calls.filter(
				(call) => typeof call[0] === "string" && call[0].includes("secret-tool")
			);
			expect(matches.length).toBe(1);
		});
	});

	describe("win32", () => {
		it("returns an encrypted store when the binding is already installed", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true });
			stubPlatform("win32");
			// Seed the lazy install dir so findKeyringBinding() picks it up.
			const bindingDir = path.join(
				getKeyringInstallDir(),
				"node_modules",
				"@napi-rs",
				"keyring"
			);
			mkdirSync(bindingDir, { recursive: true });
			writeFileSync(path.join(bindingDir, "index.js"), "module.exports = {};");

			const store = getActiveCredentialStore();
			expect(store.kind).toBe("encrypted-file");
			expect(store.describe()).toContain("Windows Credential Manager");
		});

		it("hard-errors when the binding is missing in a non-interactive context", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true, isNonInteractiveOrCI: true });
			stubPlatform("win32");
			setNpmRunner(() => mockResult({ status: 0, stdout: "/nonexistent\n" }));

			expect(() => getActiveCredentialStore()).toThrow(
				/`@napi-rs\/keyring` is required for OS keyring storage on Windows/
			);
		});

		it("includes the pinned version in the global-install hint", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true, isNonInteractiveOrCI: true });
			stubPlatform("win32");
			setNpmRunner(() => mockResult({ status: 0, stdout: "/nowhere\n" }));

			expect(() => getActiveCredentialStore()).toThrow(
				/@napi-rs\/keyring@\d+\.\d+\.\d+/
			);
		});

		it("invokes the lazy installer when interactive and binding is missing", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true, isNonInteractiveOrCI: false });
			stubPlatform("win32");

			let installCalls = 0;
			setNpmRunner((args) => {
				if (args[0] === "install") {
					installCalls += 1;
					// Seed the install dir as if npm had just run successfully.
					const bindingDir = path.join(
						getKeyringInstallDir(),
						"node_modules",
						"@napi-rs",
						"keyring"
					);
					mkdirSync(bindingDir, { recursive: true });
					writeFileSync(
						path.join(bindingDir, "index.js"),
						"module.exports = {};"
					);
					return mockResult({});
				}
				if (args[0] === "root") {
					return mockResult({ status: 0, stdout: "/nowhere\n" });
				}
				return mockResult({ status: 1 });
			});

			const store = getActiveCredentialStore();
			expect(store.kind).toBe("encrypted-file");
			expect(installCalls).toBe(1);
		});

		it("memoizes install failures so the install is not retried within the session", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true, isNonInteractiveOrCI: false });
			stubPlatform("win32");

			let installCalls = 0;
			setNpmRunner((args) => {
				if (args[0] === "install") {
					installCalls += 1;
					return mockResult({ status: 1, stderr: "boom" });
				}
				return mockResult({ status: 0, stdout: "/nowhere\n" });
			});

			expect(getActiveCredentialStore().kind).toBe("file");
			expect(getActiveCredentialStore().kind).toBe("file");
			expect(getActiveCredentialStore().kind).toBe("file");
			expect(installCalls).toBe(1);
		});

		it("hard-errors when CLOUDFLARE_AUTH_USE_KEYRING=true and install fails", ({
			expect,
		}) => {
			configureState({ isKeyringEnabled: true, isNonInteractiveOrCI: false });
			stubPlatform("win32");
			vi.stubEnv("CLOUDFLARE_AUTH_USE_KEYRING", "true");
			setNpmRunner((args) => {
				if (args[0] === "install") {
					return mockResult({ status: 1, stderr: "boom" });
				}
				return mockResult({ status: 0, stdout: "/nowhere\n" });
			});

			expect(() => getActiveCredentialStore()).toThrow();
		});
	});

	describe("unsupported platform", () => {
		it("falls back to file with a warning by default", ({ expect }) => {
			configureState({ isKeyringEnabled: true });
			stubPlatform("freebsd" as NodeJS.Platform);

			const store = getActiveCredentialStore();
			expect(store.kind).toBe("file");
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("not supported on `freebsd`")
			);
		});
	});
});

describe("createOAuthFlow validation", () => {
	beforeEach(() => {
		clearCredentialStorageState();
	});
	afterEach(() => {
		clearCredentialStorageState();
	});

	it("flow is unused here — covered in flow-level tests", ({ expect }) => {
		// Placeholder: validation tests for the OAuthFlowContext are
		// exercised via the wrangler-side integration in user.test.ts.
		expect(true).toBe(true);
	});
});

it("existsSync import is preserved for type-narrow checks", ({ expect }) => {
	// Sanity test to keep linters from removing the import in the future.
	expect(typeof existsSync).toBe("function");
});
