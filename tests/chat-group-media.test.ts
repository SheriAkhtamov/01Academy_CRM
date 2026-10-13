import { describe, expect, it } from 'vitest';
import { collectChatMedia, safeChatAttachment } from '../shared/chat-media';
import { safeChatGroupPhotoUrl } from '../shared/chat-group-photo';
import { detectInlineMediaMimeType } from '../server/lib/file-media';
import type { GroupMessageDto } from '../shared/contracts/chat-groups';
import type { MessageAttachment } from '../shared/contracts/messages';
const file = (key: string, mimeType: string): MessageAttachment => ({ id: key.repeat(21), name: `${key}.file`, size: 40, mimeType, url: `/api/chat-groups/attachments/${key.repeat(21)}` });
const message = (id: number, attachments: MessageAttachment[], content = ''): GroupMessageDto => ({ id, groupId: 4, senderId: 7, senderName: 'Alice', createdAt: '2026-10-13T08:00:00Z', content, attachments });
describe('group media catalog', () => {
  it('classifies actual attachments and orders newest messages first', () => {
    const catalog = collectChatMedia([message(1, [file('a', 'image/png'), file('b', 'video/mp4'), file('c', 'audio/mpeg')]),
      message(2, [file('d', 'image/png'), file('e', 'application/octet-stream'), file('f', 'image/gif')])]);
    expect(catalog.photos.map(item => item.file.id[0])).toEqual(['d', 'a']);
    expect(catalog.videos).toHaveLength(1); expect(catalog.audio).toHaveLength(1); expect(catalog.files).toHaveLength(1); expect(catalog.gifs).toHaveLength(1);
    expect(catalog.audio[0]).toMatchObject({ messageId: 1, senderName: 'Alice' });
  });
  it('blocks foreign, forged and direct-message attachment URLs', () => {
    const a = file('a', 'image/png');
    const catalog = collectChatMedia([message(1, [{ ...a, url: 'https://evil.test/track' }, { ...a, url: `/api/messages/attachments/${a.id}` }, { ...a, id: '../secret' }])]);
    expect(catalog.photos).toEqual([]); expect(safeChatAttachment({ ...a, url: `/api/messages/attachments/${a.id}` })).toBe(true);
    expect(safeChatGroupPhotoUrl('/api/chat-groups/4/photos/aaaaaaaaaaaaaaaaaaaaa', 5)).toBeUndefined();
    expect(safeChatGroupPhotoUrl('/api/users/photos/aaaaaaaaaaaaaaaaaaaaa', 4)).toBeUndefined();
  });
  it('deduplicates HTTP(S) links within a message and excludes credentials and active protocols', () => {
    const catalog = collectChatMedia([message(1, [], 'https://example.test/a, https://example.test/a. javascript:alert(1) https://user:pass@example.test/x https://[invalid http://site.test/hello')]);
    expect(catalog.links.map(item => item.url)).toEqual(['https://example.test/a', 'http://site.test/hello']);
  });
});
describe('audio byte detection', () => {
  it.each([['ID3abcdef', 'audio/mpeg'], ['RIFFxxxxWAVE', 'audio/wav'], ['OggSxxOpusHead', 'audio/ogg'], ['fLaCxxxx', 'audio/flac'], ['xxxxftypM4A ', 'audio/mp4']])('detects %s from bytes', (header, expected) => {
    expect(detectInlineMediaMimeType(Buffer.from(header))).toBe(expected);
  });
  it('keeps HTML, SVG and unknown containers as downloads', () => {
    for (const header of ['<script>alert(1)</script>', '<svg>', 'OggSnot_audio', 'xxxxftypunknown']) expect(detectInlineMediaMimeType(Buffer.from(header))).toBe('application/octet-stream');
  });
});
