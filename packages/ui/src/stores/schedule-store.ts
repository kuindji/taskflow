import { create } from "zustand";
import type { Schedule, ScheduleCreatePayload, ScheduleUpdatePayload } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

interface ScheduleStore {
    schedules: Schedule[];
    loading: boolean;

    fetchSchedules(projectId?: string): Promise<void>;
    createSchedule(payload: ScheduleCreatePayload): Promise<Schedule>;
    updateSchedule(payload: ScheduleUpdatePayload): Promise<Schedule>;
    deleteSchedule(id: string): Promise<void>;
    triggerSchedule(id: string): Promise<void>;

    applyUpdate(schedule: Schedule): void;
}

const useScheduleStore = create<ScheduleStore>((set) => ({
    schedules: [],
    loading: false,

    async fetchSchedules(projectId) {
        set({ loading: true });
        try {
            const { schedules } = await sendRequest<{ schedules: Schedule[] }>(
                MSG.SCHEDULE_LIST,
                { projectId },
            );
            set({ schedules });
        } finally {
            set({ loading: false });
        }
    },

    async createSchedule(payload) {
        const schedule = await sendRequest<Schedule>(MSG.SCHEDULE_CREATE, payload);
        set((s) => ({ schedules: [...s.schedules, schedule] }));
        return schedule;
    },

    async updateSchedule(payload) {
        const updated = await sendRequest<Schedule>(MSG.SCHEDULE_UPDATE, payload);
        set((s) => ({
            schedules: s.schedules.map((sc) => (sc.id === updated.id ? updated : sc)),
        }));
        return updated;
    },

    async deleteSchedule(id) {
        await sendRequest(MSG.SCHEDULE_DELETE, { id });
        set((s) => ({ schedules: s.schedules.filter((sc) => sc.id !== id) }));
    },

    async triggerSchedule(id) {
        await sendRequest(MSG.SCHEDULE_TRIGGER, { id });
    },

    applyUpdate(schedule) {
        set((s) => {
            const exists = s.schedules.some((sc) => sc.id === schedule.id);
            if (exists) {
                return { schedules: s.schedules.map((sc) => (sc.id === schedule.id ? schedule : sc)) };
            }
            return { schedules: [...s.schedules, schedule] };
        });
    },
}));

// Module-level event listener for schedule updates (same pattern as flow-store.ts)
const _unsubScheduleUpdated = onEvent(MSG.SCHEDULE_UPDATED, (payload) => {
    if (payload && typeof payload === "object" && "id" in payload) {
        useScheduleStore.getState().applyUpdate(payload as Schedule);
    }
});

export { useScheduleStore };
