import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	getGlobalWranglerConfigPath,
	UserError,
} from "@cloudflare/workers-utils";
import { getAuthConfigFilePath } from "./auth-config-file";

const RESERVED_PROFILE_NAMES = ["default", "staging"];

const DIRECTORY_BINDINGS_FILE = "profiles/directory-bindings.json";

export function validateProfileName(name: string): void {
	if (RESERVED_PROFILE_NAMES.includes(name.toLowerCase())) {
		throw new UserError(
			`"${name}" is a reserved profile name. Use \`wrangler login\` and \`wrangler logout\` to manage the default profile, which applies as a global fallback.`,
			{ telemetryMessage: "auth profile reserved name" }
		);
	}

	if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
		throw new UserError(
			`Invalid profile name "${name}". Profile names may only contain alphanumeric characters, hyphens, and underscores.`,
			{ telemetryMessage: "auth profile invalid name" }
		);
	}
}

export function profileExists(profile: string): boolean {
	return existsSync(getAuthConfigFilePath(profile));
}

export function listProfilePaths(): string[] {
	const configDir = path.join(getGlobalWranglerConfigPath(), "config");
	if (!existsSync(configDir)) {
		return [];
	}

	const files = readdirSync(configDir);
	return files
		.filter((f) => f.endsWith(".toml"))
		.map((f) => f.replace(/\.toml$/, ""));
}

export function deleteProfileFile(profile: string): void {
	const filePath = getAuthConfigFilePath(profile);
	if (existsSync(filePath)) {
		rmSync(filePath);
	}
}

function getDirectoryBindingsPath(): string {
	return path.join(getGlobalWranglerConfigPath(), DIRECTORY_BINDINGS_FILE);
}

export function readDirectoryBindings(): Record<string, string> {
	try {
		const raw = readFileSync(getDirectoryBindingsPath(), "utf-8");
		return JSON.parse(raw) as Record<string, string>;
	} catch {
		return {};
	}
}

export function writeDirectoryBindings(bindings: Record<string, string>): void {
	const bindingsPath = getDirectoryBindingsPath();
	mkdirSync(path.dirname(bindingsPath), { recursive: true });
	writeFileSync(bindingsPath, JSON.stringify(bindings, null, "\t"), "utf-8");
}

export function activateProfileForDirectory(
	profile: string,
	dir: string
): void {
	const normalizedDir = path.resolve(dir);
	const bindings = readDirectoryBindings();
	bindings[normalizedDir] = profile;
	writeDirectoryBindings(bindings);
}

export function deactivateDirectory(dir: string): {
	removedProfile: string;
	newResolution: { profile: string | undefined; source: string };
} {
	const normalizedDir = path.resolve(dir);
	const bindings = readDirectoryBindings();

	const boundProfile = bindings[normalizedDir];
	if (boundProfile === undefined) {
		const parentBinding = getProfileForDirectoryFromBindings(
			normalizedDir,
			bindings
		);
		if (parentBinding) {
			const parentDir = Object.entries(bindings).find(
				([, profile]) => profile === parentBinding
			)?.[0];
			throw new UserError(
				`No profile is directly bound to "${normalizedDir}". The active profile "${parentBinding}" is bound at "${parentDir}". Run \`wrangler auth deactivate\` from that directory instead.`,
				{ telemetryMessage: "auth deactivate wrong directory" }
			);
		}
		throw new UserError(
			`No profile is bound to "${normalizedDir}". Nothing to deactivate.`,
			{ telemetryMessage: "auth deactivate no binding" }
		);
	}

	delete bindings[normalizedDir];
	writeDirectoryBindings(bindings);

	const fallbackProfile = getProfileForDirectoryFromBindings(
		normalizedDir,
		bindings
	);
	if (fallbackProfile) {
		const fallbackDir = Object.entries(bindings).find(
			([, p]) => p === fallbackProfile
		)?.[0];
		return {
			removedProfile: boundProfile,
			newResolution: {
				profile: fallbackProfile,
				source: `inherited from ${fallbackDir}`,
			},
		};
	}
	if (profileExists("default")) {
		return {
			removedProfile: boundProfile,
			newResolution: { profile: "default", source: "default profile" },
		};
	}
	return {
		removedProfile: boundProfile,
		newResolution: { profile: undefined, source: "no profile" },
	};
}

/**
 * Finds the most-specific directory binding that covers `startDir` using
 * string prefix matching. Bindings are sorted by path length descending so
 * the longest (most-specific) match wins. The match must be at a path
 * boundary — the binding path must either equal `startDir` exactly or be
 * followed by a path separator.
 */
function getProfileForDirectoryFromBindings(
	startDir: string,
	bindings: Record<string, string>
): string | undefined {
	const normalizedDir = path.resolve(startDir);

	const sortedEntries = Object.entries(bindings).sort(
		([a], [b]) => b.length - a.length
	);

	for (const [boundDir, profile] of sortedEntries) {
		if (normalizedDir === boundDir) {
			return profile;
		}
		if (
			normalizedDir.startsWith(boundDir) &&
			normalizedDir[boundDir.length] === path.sep
		) {
			return profile;
		}
	}

	return undefined;
}

export function getProfileForDirectory(startDir: string): string | undefined {
	const bindings = readDirectoryBindings();
	return getProfileForDirectoryFromBindings(startDir, bindings);
}

export function getBindingsForProfile(profile: string): string[] {
	const bindings = readDirectoryBindings();
	return Object.entries(bindings)
		.filter(([, p]) => p === profile)
		.map(([dir]) => dir);
}

export function removeAllBindingsForProfile(profile: string): string[] {
	const bindings = readDirectoryBindings();
	const removed: string[] = [];
	for (const [dir, p] of Object.entries(bindings)) {
		if (p === profile) {
			removed.push(dir);
			delete bindings[dir];
		}
	}
	if (removed.length > 0) {
		writeDirectoryBindings(bindings);
	}
	return removed;
}

/**
 * Resolves which profile to use.
 *
 * Priority:
 * 1. Explicit `--profile` flag
 * 2. Directory binding prefix match from `configPath` directory or cwd
 * 3. `"default"`
 */
export function resolveProfile(args: {
	profile?: string;
	configPath?: string | string[];
}): string {
	if (args.profile) {
		validateProfileName(args.profile);
		return args.profile;
	}

	const firstConfigPath = Array.isArray(args.configPath)
		? args.configPath[0]
		: args.configPath;

	const startDir = firstConfigPath
		? path.dirname(path.resolve(firstConfigPath))
		: process.cwd();

	const dirProfile = getProfileForDirectory(startDir);
	if (dirProfile) {
		return dirProfile;
	}

	return "default";
}
