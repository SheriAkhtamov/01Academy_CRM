import { describe, expect, it } from 'vitest';
import {
  getInstagramIntegrationConfig,
  hydrateInstagramMessageAttachments,
  normalizeInstagramMessageAttachments,
} from '../server/services/instagram';

describe('Instagram webhook configuration', () => {
  it('subscribes only to fields accepted by the current Instagram API', () => {
    const { webhookFields } = getInstagramIntegrationConfig();

    expect(webhookFields).toContain('messages');
    expect(webhookFields).toContain('messaging_seen');
    expect(webhookFields).toContain('message_reactions');
    expect(webhookFields).not.toContain('message_deliveries');
  });
});

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

  it('builds a cover for the Reel-only payload sent by Instagram webhooks', () => {
    const attachments = normalizeInstagramMessageAttachments({
      attachments: [{
        type: 'ig_reel',
        payload: {
          reel_video_id: '17890000000000000',
          title: 'Shared reel',
          url: 'https://www.instagram.com/reel/C0FFEE/',
        },
      }],
    });

    expect(attachments).toEqual([{
      type: 'reel',
      url: 'https://www.instagram.com/p/C0FFEE/media/?size=l',
      previewUrl: 'https://www.instagram.com/p/C0FFEE/media/?size=l',
      link: 'https://www.instagram.com/reel/C0FFEE/',
      title: 'Shared reel',
      subtitle: undefined,
    }]);
  });

  it('hydrates covers for legacy Reel rows and restores empty stored attachments from raw payload', () => {
    const legacy = hydrateInstagramMessageAttachments([{
      type: 'reel',
      link: 'https://www.instagram.com/reel/LEGACY1/',
    }]);
    const restored = hydrateInstagramMessageAttachments([], {
      message: {
        attachments: [{
          type: 'ig_reel',
          payload: {
            reel_video_id: '17890000000000001',
            url: 'https://www.instagram.com/reel/RESTORED1/',
          },
        }],
      },
    });

    expect(legacy).toEqual([{
      type: 'reel',
      url: 'https://www.instagram.com/p/LEGACY1/media/?size=l',
      previewUrl: 'https://www.instagram.com/p/LEGACY1/media/?size=l',
      link: 'https://www.instagram.com/reel/LEGACY1/',
    }]);
    expect(restored).toEqual([{
      type: 'reel',
      url: 'https://www.instagram.com/p/RESTORED1/media/?size=l',
      previewUrl: 'https://www.instagram.com/p/RESTORED1/media/?size=l',
      link: 'https://www.instagram.com/reel/RESTORED1/',
      title: undefined,
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
