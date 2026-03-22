export interface Notification {
    id: string;
    projectId: string;
    sessionId: string;
    taskId?: string;
    message: string;
    read: boolean;
    createdAt: string;
}
