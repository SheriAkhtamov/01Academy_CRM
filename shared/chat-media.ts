import type { GroupMessageDto } from './contracts/chat-groups';
import type { MessageAttachment } from './contracts/messages';

export const INLINE_CHAT_MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/flac'];
export const safeChatAttachment = (file: MessageAttachment, groupOnly = false) => /^[A-Za-z0-9_-]{21}$/.test(file.id)
  && (file.url === `/api/chat-groups/attachments/${file.id}` || (!groupOnly && file.url === `/api/messages/attachments/${file.id}`));
export const CHAT_MEDIA_CATEGORIES = ['photos', 'videos', 'audio', 'files', 'links', 'gifs'] as const;
export type ChatMediaCategory = typeof CHAT_MEDIA_CATEGORIES[number];
type ChatMediaAuthor = { senderId?: number | null; senderName: string; senderAvatarUrl?: string | null; createdAt: string };
export type ChatMediaItem = ChatMediaAuthor & { messageId: number; file: MessageAttachment };
export type ChatLinkItem = ChatMediaAuthor & { messageId: number; url: string };
export type ChatMediaCatalog = Record<Exclude<ChatMediaCategory, 'links'>, ChatMediaItem[]> & { links: ChatLinkItem[] };
export function collectChatMedia(messages: GroupMessageDto[]): ChatMediaCatalog {
  const catalog: ChatMediaCatalog = { photos: [], videos: [], audio: [], files: [], links: [], gifs: [] };
  for (const message of [...messages].sort((a, b) => b.id - a.id)) {
    const identity = { messageId: message.id, senderId: message.senderId, senderName: message.senderName, senderAvatarUrl: message.senderAvatarUrl, createdAt: message.createdAt };
    for (const file of message.attachments) {
      if (!safeChatAttachment(file, true)) continue;
      const category = file.mimeType === 'image/gif' ? 'gifs' : file.mimeType.startsWith('image/') ? 'photos'
        : file.mimeType.startsWith('video/') ? 'videos' : file.mimeType.startsWith('audio/') ? 'audio' : 'files';
      catalog[category].push({ ...identity, file });
    }
    const urls = new Set<string>();
    for (const match of message.content.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      try {
        const url = new URL(match[0].replace(/[.,;!?)}\]]+$/, ''));
        if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) continue;
        urls.add(url.href);
      } catch { /* Ignore malformed links. */ }
    }
    for (const url of urls) catalog.links.push({ ...identity, url });
  }
  return catalog;
}
