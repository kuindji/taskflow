import Foundation

/// Notifications list backing the sidebar popover. Port of stores/notification-store.ts.
@MainActor @Observable final class NotificationViewModel {
    private(set) var notifications: [Notification] = []

    @ObservationIgnored private let client: WSClient
    init(client: WSClient) { self.client = client }

    // MARK: - Bind (WS event subscriptions)

    func bind() {
        client.on(.notificationCreated) { [weak self] (event: NotificationCreatedEvent) in
            Task { @MainActor [weak self] in
                self?.notifications = Self.upsert(self?.notifications ?? [], event.notification)
            }
        }
        client.on(.notificationUpdated) { [weak self] (event: NotificationUpdatedEvent) in
            Task { @MainActor [weak self] in
                self?.notifications = Self.upsert(self?.notifications ?? [], event.notification)
            }
        }
        client.on(.notificationDeleted) { [weak self] (event: NotificationDeletedEvent) in
            Task { @MainActor [weak self] in
                if event.all == true {
                    self?.notifications = []
                } else if let id = event.id {
                    self?.notifications = Self.remove(self?.notifications ?? [], id: id)
                }
            }
        }
    }

    // MARK: - Load (fetchNotifications equivalent)

    func load() async {
        if let res: NotificationListResponse = try? await client.request(.notificationList, payload: [:]) {
            notifications = Self.sorted(res.notifications)
        }
    }

    // MARK: - Actions

    /// Marks a notification as read optimistically and sends the RPC.
    /// TS: `sendRequest(MSG.NOTIFICATION_UPDATED, { id })`
    func markAsRead(id: String) async {
        notifications = Self.markRead(notifications, id: id)
        client.send(.notificationUpdated, payload: ["id": id])
    }

    /// Removes a notification optimistically and sends the RPC.
    /// TS: `sendRequest(MSG.NOTIFICATION_DELETED, { id })`
    func deleteNotification(id: String) async {
        notifications = Self.remove(notifications, id: id)
        client.send(.notificationDeleted, payload: ["id": id])
    }

    /// Clears all notifications optimistically and sends the RPC.
    /// TS: `sendRequest(MSG.NOTIFICATION_DELETED, { all: true })`
    func deleteAll() async {
        notifications = []
        client.send(.notificationDeleted, payload: ["all": true])
    }

    // MARK: - Pure reducers

    nonisolated static func upsert(_ list: [Notification], _ n: Notification) -> [Notification] {
        if let i = list.firstIndex(where: { $0.id == n.id }) {
            var copy = list; copy[i] = n; return copy
        }
        return list + [n]
    }

    nonisolated static func remove(_ list: [Notification], id: String) -> [Notification] {
        list.filter { $0.id != id }
    }

    nonisolated static func markRead(_ list: [Notification], id: String) -> [Notification] {
        list.map { $0.id == id ? Notification(id: $0.id, projectId: $0.projectId,
                                              sessionId: $0.sessionId, taskId: $0.taskId,
                                              message: $0.message, read: true,
                                              createdAt: $0.createdAt) : $0 }
    }

    nonisolated static func sorted(_ list: [Notification]) -> [Notification] {
        list.sorted { $0.createdAt > $1.createdAt }
    }
}
