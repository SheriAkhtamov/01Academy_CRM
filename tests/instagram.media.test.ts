import { describe, expect, it } from 'vitest';
import { normalizeInstagramMessageAttachments } from '../server/services/instagram';

describe('Instagram media normalization', () => {
  it('keeps a Reel with a direct video URL playable inline', () => {
    const attachments = normalizeInstagramMessageAttachments({
      attachments: [{
        type: 'reel',
        payload: {
          reel: {
            video_url: 'https://scontent.cdninstagram.com/reel-video',
            thumbnail_url: 'https://scontent.cdninstagram.com/reel-thumbnail',
          },
        },
      }],
    });

    expect(attachments).toEqual([{
      type: 'video',
      url: 'https://scontent.cdninstagram.com/reel-video',
      previewUrl: 'https://scontent.cdninstagram.com/reel-thumbnail',
      link: undefined,
      title: undefined,
      subtitle: undefined,
    }]);
  });

  it('keeps a shared Reel as a Reel permalink when Meta provides only a preview', () => {
    const attachments = normalizeInstagramMessageAttachments({
      shares: [{
        link: 'https://www.instagram.com/reel/C0FFEE/',
        picture: 'https://scontent.cdninstagram.com/reel-preview',
        title: 'A shared Reel',
      }],
    });

    expect(attachments).toEqual([{
      type: 'reel',
      url: 'https://scontent.cdninstagram.com/reel-preview',
      previewUrl: 'https://scontent.cdninstagram.com/reel-preview',
      link: 'https://www.instagram.com/reel/C0FFEE/',
      title: 'A shared Reel',
      subtitle: undefined,
    }]);
  });

  it('normalizes image, GIF, audio, and file attachments without downgrading them to photos', () => {
    const attachments = normalizeInstagramMessageAttachments({
      attachments: [
        { type: 'image', payload: { image_url: 'https://scontent.cdninstagram.com/photo' } },
        { type: 'animated_gif', payload: { animated_gif_url: 'https://scontent.cdninstagram.com/animation' } },
        { type: 'audio', payload: { audio_url: 'https://scontent.cdninstagram.com/voice-note' } },
        { type: 'file', file_url: 'https://lookaside.fbsbx.com/document.pdf' },
      ],
    });

    expect(attachments.map((attachment) => attachment.type)).toEqual([
      'image',
      'animated_gif',
      'audio',
      'file',
    ]);
  });
});
