// Both declarations land in packages/shared/src/types/backend.ts:
//   - the first from the superseded plan's Task 2, carried forward "in full"
//     as this plan's Task 3 (2026-08-23-taskflow-multi-backend.md:505-533)
//   - the second added by this plan's Task 5, Step 4 (line 859)
// TypeScript merges same-named interfaces in the same file, so the result
// requires every field of both.

export interface BackendRecord {
    id: string;
    host: string;
    instanceId: string;
    displayName: string;
    user: string;
    sshPort: number;
    hostSource: "manual" | "discovery";
    manualPort: number | null;
    lastKnownPort: number | null;
    addedAt: string;
}

export interface BackendRecord {
    id: string;
    backendUid: string | null;
    host: string;
    instanceId: string;
    displayName: string;
    user: string;
    sshPort: number;
    lastKnownPort: number | null;
    attached: boolean;
    addedAt: string;
}

// This plan's Task 5, Step 2 test fixture (line 780) — no hostSource/manualPort.
export const newFixture: BackendRecord = {
    id: "desktop.local:main",
    backendUid: null,
    host: "desktop.local",
    instanceId: "main",
    displayName: "desktop",
    user: "kuindji",
    sshPort: 22,
    lastKnownPort: null,
    attached: false,
    addedAt: "2026-08-24T00:00:00.000Z",
};

// The carried Task 6's fixture (2026-08-23-...:2106) — no backendUid/attached.
export const carriedFixture: BackendRecord = {
    id: "desktop:main",
    host: "192.168.1.20",
    instanceId: "main",
    displayName: "desktop",
    user: "kuindji",
    sshPort: 22,
    hostSource: "discovery",
    manualPort: null,
    lastKnownPort: 54892,
    addedAt: "2026-08-23T00:00:00.000Z",
};
