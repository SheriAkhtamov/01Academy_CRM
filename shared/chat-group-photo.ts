export const safeChatGroupPhotoUrl = (url: string | null | undefined, groupId: number) =>
  url && new RegExp(`^/api/chat-groups/${groupId}/photos/[A-Za-z0-9_-]{21}$`).test(url) ? url : undefined;
