import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "./logger";

export type ExperimentalFlags = {
	MULTIWORKER: boolean;
	RESOURCES_PROVISION: boolean;
	AUTOCREATE_RESOURCES: boolean;
};

type CommandContext = ExperimentalFlags & {
	profile: string;
};

const store = new AsyncLocalStorage<CommandContext>();

export const run = <V>(context: CommandContext, cb: () => V) =>
	store.run(context, cb);

export const getFlag = <F extends keyof ExperimentalFlags>(flag: F) => {
	const s = store.getStore();
	if (s === undefined) {
		logger.debug("No experimental flag store instantiated");
	}
	const value = s?.[flag];
	if (value === undefined) {
		logger.debug(
			`Attempted to use flag "${flag}" which has not been instantiated`
		);
	}
	return value;
};

export function getProfile(): string {
	return store.getStore()?.profile ?? "default";
}
