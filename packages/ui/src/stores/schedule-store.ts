import { create } from "zustand";
import type {
    Schedule,
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    ScheduleListResponse,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { createSlices, type Scoped } from "@/lib/backend-scope";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";

/**
 * Every schedule belongs to a project, so its machine is its project's machine.
 * Mutations take the record and go to its `backendId`; creation names the
 * project's machine.
 */
interface ScheduleStore {
    schedules: Scoped<Schedule>[];
    loading: boolean;

    fetchSchedules(backendId: string): Promise<void>;
    createSchedule(backendId: string, payload: ScheduleCreatePayload): Promise<Scoped<Schedule>>;
    updateSchedule(
        schedule: Scoped<Schedule>,
        changes: Omit<ScheduleUpdatePayload, "id">,
    ): Promise<Scoped<Schedule>>;
    deleteSchedule(schedule: Scoped<Schedule>): Promise<void>;
    triggerSchedule(schedule: Scoped<Schedule>): Promise<void>;
}

const slices = createSlices<Schedule>();

function publish(): void {
    useScheduleStore.setState({ schedules: slices.read() });
}

function upsert(backendId: string, schedule: Schedule): Scoped<Schedule> {
    const scoped = { ...schedule, backendId };
    slices.apply(backendId, (items) =>
        items.some((sc) => sc.id === schedule.id)
            ? items.map((sc) => (sc.id === schedule.id ? scoped : sc))
            : [...items, scoped],
    );
    publish();
    return scoped;
}

const useScheduleStore = create<ScheduleStore>((set) => ({
    schedules: [],
    loading: false,

    async fetchSchedules(backendId) {
        set({ loading: true });
        try {
            const landed = await slices.load(backendId, async () => {
                const { schedules } = await sendRequest<ScheduleListResponse>(
                    backendId,
                    MSG.SCHEDULE_LIST,
                    {},
                );
                return schedules;
            });
            if (landed) publish();
        } finally {
            set({ loading: false });
        }
    },

    async createSchedule(backendId, payload) {
        const schedule = await sendRequest<Schedule>(backendId, MSG.SCHEDULE_CREATE, payload);
        // SCHEDULE_UPDATED may have landed first.
        return upsert(backendId, schedule);
    },

    async updateSchedule(schedule, changes) {
        const updated = await sendRequest<Schedule>(schedule.backendId, MSG.SCHEDULE_UPDATE, {
            ...changes,
            id: schedule.id,
        });
        const scoped = { ...updated, backendId: schedule.backendId };
        slices.apply(schedule.backendId, (items) =>
            items.map((sc) => (sc.id === updated.id ? scoped : sc)),
        );
        publish();
        return scoped;
    },

    async deleteSchedule(schedule) {
        await sendRequest(schedule.backendId, MSG.SCHEDULE_DELETE, { id: schedule.id });
        slices.apply(schedule.backendId, (items) => items.filter((sc) => sc.id !== schedule.id));
        publish();
    },

    async triggerSchedule(schedule) {
        await sendRequest(schedule.backendId, MSG.SCHEDULE_TRIGGER, { id: schedule.id });
    },
}));

registerBackendReset("schedule-store", (backendId) => {
    slices.drop(backendId);
    publish();
});

const _unsubScheduleUpdated = onEvent(MSG.SCHEDULE_UPDATED, (payload, backendId) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        upsert(backendId, payload as Schedule);
    }
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubScheduleUpdated();
    });
}

export { useScheduleStore };
