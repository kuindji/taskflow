import { MSG } from "@taskflow/shared";
import type {
    Schedule,
    ScheduleCreatePayload,
    ScheduleListResponse,
    ScheduleUpdatePayload,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";

function upsert(items: readonly Schedule[], next: Schedule): Schedule[] {
    const index = items.findIndex((item) => item.id === next.id);
    if (index < 0) return [...items, next];
    const copy = [...items];
    copy[index] = next;
    return copy;
}

class ScheduleStore {
    private scheduleList: Schedule[] = [];
    private projectFilter: string | undefined;
    private readonly listeners = new Set<() => void>();
    private readonly disposers: (() => void)[] = [];
    private readonly eventUpdates = new Map<string, { revision: number; schedule: Schedule }>();
    private loadToken = 0;
    private eventRevision = 0;
    private disposed = false;

    constructor(private readonly net: NetLike) {
        this.disposers.push(
            net.on(MSG.SCHEDULE_UPDATED, (payload) => {
                if (!payload || typeof payload !== "object" || !("id" in payload)) return;
                const schedule = payload as Schedule;
                const revision = ++this.eventRevision;
                this.eventUpdates.set(schedule.id, { revision, schedule });
                if (this.matchesFilter(schedule)) {
                    this.scheduleList = upsert(this.scheduleList, schedule);
                } else {
                    this.scheduleList = this.scheduleList.filter((item) => item.id !== schedule.id);
                }
                this.notify();
            }),
        );
    }

    get schedules(): readonly Schedule[] {
        return this.scheduleList;
    }

    get filterProjectId(): string | undefined {
        return this.projectFilter;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        if (this.disposed) return;
        for (const listener of [...this.listeners]) listener();
    }

    private matchesFilter(schedule: Schedule): boolean {
        return this.projectFilter === undefined || schedule.projectId === this.projectFilter;
    }

    async load(projectId?: string): Promise<void> {
        const token = ++this.loadToken;
        const revision = this.eventRevision;
        const response = await this.net.request<ScheduleListResponse>(MSG.SCHEDULE_LIST, {
            projectId,
        });
        if (this.disposed || token !== this.loadToken) return;
        this.projectFilter = projectId;
        let schedules = response.schedules;
        for (const update of this.eventUpdates.values()) {
            if (update.revision <= revision) continue;
            schedules = upsert(schedules, update.schedule);
        }
        this.scheduleList = schedules.filter((schedule) => this.matchesFilter(schedule));
        this.notify();
    }

    async create(payload: ScheduleCreatePayload): Promise<Schedule> {
        const schedule = await this.net.request<Schedule>(MSG.SCHEDULE_CREATE, payload);
        if (this.matchesFilter(schedule)) this.scheduleList = upsert(this.scheduleList, schedule);
        this.notify();
        return schedule;
    }

    async update(payload: ScheduleUpdatePayload): Promise<Schedule> {
        const schedule = await this.net.request<Schedule>(MSG.SCHEDULE_UPDATE, payload);
        if (this.matchesFilter(schedule)) this.scheduleList = upsert(this.scheduleList, schedule);
        else this.scheduleList = this.scheduleList.filter((item) => item.id !== schedule.id);
        this.notify();
        return schedule;
    }

    async delete(id: string): Promise<void> {
        await this.net.request(MSG.SCHEDULE_DELETE, { id });
        this.scheduleList = this.scheduleList.filter((schedule) => schedule.id !== id);
        this.notify();
    }

    async trigger(id: string): Promise<void> {
        await this.net.request(MSG.SCHEDULE_TRIGGER, { id });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.listeners.clear();
    }
}

export { ScheduleStore };
