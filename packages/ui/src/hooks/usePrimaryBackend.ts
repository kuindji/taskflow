import { useSyncExternalStore } from "react";
import { getPrimary, onPrimaryChange } from "@/lib/connection-registry";

/** Primary's id: the machine the app-level surfaces (settings, managers) address. */
export function usePrimaryBackend(): string | null {
    return useSyncExternalStore(onPrimaryChange, getPrimary);
}
