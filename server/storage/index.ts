import { userStorage } from './user.storage';
import { notificationStorage } from './notification.storage';
import { auditStorage } from './audit.storage';
import { messageStorage } from './message.storage';
import { boardStorage } from './board.storage';

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
    getUserWorkspaces: userStorage.getUserWorkspaces.bind(userStorage),
    setUserWorkspaces: userStorage.setUserWorkspaces.bind(userStorage),
    ensureUserWorkspace: userStorage.ensureUserWorkspace.bind(userStorage),
    updateUserOnlineStatus: userStorage.updateUserOnlineStatus.bind(userStorage),
    getUsersWithOnlineStatus: userStorage.getUsersWithOnlineStatus.bind(userStorage),

    // Saved accounts (multi-account switching)
    getSavedAccounts: userStorage.getSavedAccounts.bind(userStorage),
    getSavedAccountsForUser: userStorage.getSavedAccountsForUser.bind(userStorage),
    addSavedAccount: userStorage.addSavedAccount.bind(userStorage),
    findSavedAccountByTokenHash: userStorage.findSavedAccountByTokenHash.bind(userStorage),
    deleteSavedAccount: userStorage.deleteSavedAccount.bind(userStorage),
    deleteSavedAccountById: userStorage.deleteSavedAccountById.bind(userStorage),
    deleteSavedAccountByIdForUser: userStorage.deleteSavedAccountByIdForUser.bind(userStorage),

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
    markConversationAsRead: messageStorage.markConversationAsRead.bind(messageStorage),
    markMessageAsRead: async (id: number, userId: number) => {
        if (!userId) {
            throw new Error('userId is required to mark message as read');
        }
        return messageStorage.markMessageAsRead(id, userId);
    },

    // Management board operations (Kanban). Exposed as a namespace since it
    // groups many task/comment/checklist/attachment methods.
    board: boardStorage,
};
