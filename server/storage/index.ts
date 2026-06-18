import { userStorage } from './user.storage';
import { notificationStorage } from './notification.storage';
import { auditStorage } from './audit.storage';
import { messageStorage } from './message.storage';

export const storage = {
    // User operations
    getUser: userStorage.getUser.bind(userStorage),
    getUserByEmail: userStorage.getUserByEmail.bind(userStorage),
    getUserByLoginOrEmail: userStorage.getUserByLoginOrEmail.bind(userStorage),
    getUsers: userStorage.getUsers.bind(userStorage),
    getUserWithPassword: userStorage.getUserWithPassword.bind(userStorage),
    createUser: userStorage.createUser.bind(userStorage),
    updateUser: userStorage.updateUser.bind(userStorage),
    deleteUser: userStorage.deleteUser.bind(userStorage),
    updateUserOnlineStatus: userStorage.updateUserOnlineStatus.bind(userStorage),
    getUsersWithOnlineStatus: userStorage.getUsersWithOnlineStatus.bind(userStorage),

    // Notification operations
    getNotificationsByUser: notificationStorage.getNotificationsByUser.bind(notificationStorage),
    createNotification: notificationStorage.createNotification.bind(notificationStorage),
    markNotificationAsRead: notificationStorage.markNotificationAsRead.bind(notificationStorage),
    markAllNotificationsAsRead: notificationStorage.markAllNotificationsAsRead.bind(notificationStorage),
    deleteNotification: notificationStorage.deleteNotification.bind(notificationStorage),

    // Audit Log operations
    createAuditLog: auditStorage.createAuditLog.bind(auditStorage),

    // Message operations
    getConversationsByUser: messageStorage.getConversations.bind(messageStorage),
    getMessagesBetweenUsers: messageStorage.getMessagesBetweenUsers.bind(messageStorage),
    createMessage: messageStorage.createMessage.bind(messageStorage),
    markMessageAsRead: async (id: number, userId: number) => {
        if (!userId) {
            throw new Error('userId is required to mark message as read');
        }
        return messageStorage.markMessageAsRead(id, userId);
    },
};
