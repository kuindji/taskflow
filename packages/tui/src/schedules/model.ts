import type { Schedule } from "@taskflow/shared";

function scheduleStatusText(schedule: Schedule): string {
    if (schedule.runningSessionId) return "Running";
    if (!schedule.enabled) return "Disabled";
    if (schedule.lastError) return "Error";
    return "Scheduled";
}

export { scheduleStatusText };
