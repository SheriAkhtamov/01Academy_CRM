export const LEAD_CHANNELS = ['instagram', 'telegram', 'facebook', 'whatsapp'] as const;
export type LeadChannelKind = (typeof LEAD_CHANNELS)[number];

export interface LeadChannelView {
  id: number;
  channel: string;
  providerAccountId?: string | null;
  externalId?: string | null;
  handle?: string | null;
  displayName?: string | null;
  profileUrl?: string | null;
  isManual?: boolean;
}

export interface NormalizedLeadSocialAccount {
  channel: LeadChannelKind;
  handle: string;
  profileUrl: string;
}

const SOCIAL_CHANNEL_SET = new Set<string>(LEAD_CHANNELS);
const INSTAGRAM_HANDLE = /^[a-z0-9._]{1,30}$/i;
const TELEGRAM_HANDLE = /^[a-z0-9_]{5,32}$/i;
const FACEBOOK_HANDLE = /^[a-z0-9._-]{1,100}$/i;
const WHATSAPP_PHONE = /^\d{7,15}$/;
const NON_PROFILE_FACEBOOK_PATHS = new Set([
  'events',
  'groups',
  'marketplace',
  'reel',
  'share',
  'stories',
  'watch',
]);
const NON_PROFILE_INSTAGRAM_PATHS = new Set(['explore', 'p', 'reel', 'stories']);

const parseSocialUrl = (value: string) => {
  const trimmed = value.trim();
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^(?:www\.|m\.)?(?:instagram\.com|t\.me|telegram\.me|facebook\.com|wa\.me|api\.whatsapp\.com)\//i.test(trimmed)
      ? `https://${trimmed}`
      : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.protocol = 'https:';
    return url;
  } catch {
    return null;
  }
};

const firstPathSegment = (url: URL) => {
  const segment = url.pathname.split('/').filter(Boolean)[0] ?? '';
  try {
    return decodeURIComponent(segment).replace(/^@+/, '');
  } catch {
    return segment.replace(/^@+/, '');
  }
};

export const normalizeLeadChannelHandle = (value: unknown) => {
  const raw = String(value ?? '').trim();
  let candidate = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      candidate = new URL(raw).pathname.split('/').filter(Boolean)[0] ?? '';
    } catch {
      candidate = raw;
    }
  }
  const handle = candidate.replace(/^@+/, '').replace(/[/?#].*$/, '');
  return handle || null;
};

export const leadChannelDisplayKey = (channel: LeadChannelView) => {
  const normalizedChannel = channel.channel.trim().toLowerCase();
  const normalizedHandle = normalizeLeadChannelHandle(channel.handle)?.toLowerCase();
  if (normalizedChannel === 'whatsapp') {
    const whatsappPhone = String(
      normalizedHandle
      ?? channel.externalId
      ?? channel.profileUrl
      ?? '',
    ).replace(/\D/g, '');
    if (WHATSAPP_PHONE.test(whatsappPhone)) {
      return `${normalizedChannel}:phone:${whatsappPhone}`;
    }
  }
  if (normalizedHandle) return `${normalizedChannel}:handle:${normalizedHandle}`;

  const externalId = String(channel.externalId ?? '').trim().toLowerCase();
  if (externalId) return `${normalizedChannel}:external:${externalId}`;

  const profileUrl = safeLeadChannelProfileUrl(normalizedChannel, channel.profileUrl)?.toLowerCase();
  if (profileUrl) return `${normalizedChannel}:profile:${profileUrl}`;

  return `${normalizedChannel}:id:${channel.id}`;
};

export const dedupeLeadChannelsForDisplay = (channels?: LeadChannelView[] | null) => {
  const uniqueChannels = new Map<string, LeadChannelView>();
  for (const channel of channels ?? []) {
    const key = leadChannelDisplayKey(channel);
    const current = uniqueChannels.get(key);
    const currentPriority = Number(Boolean(current?.providerAccountId)) + Number(Boolean(current?.externalId));
    const nextPriority = Number(Boolean(channel.providerAccountId)) + Number(Boolean(channel.externalId));
    if (!current || nextPriority > currentPriority) uniqueChannels.set(key, channel);
  }
  return [...uniqueChannels.values()];
};

export const buildLeadChannelProfileUrl = (
  channel: string,
  handle?: unknown,
  phone?: unknown,
) => {
  const normalizedChannel = channel.trim().toLowerCase();
  const rawHandle = String(handle ?? '').trim().replace(/^@+/, '');
  const normalizedHandle = normalizeLeadChannelHandle(handle);
  if (normalizedChannel === 'instagram' && normalizedHandle) {
    return `https://www.instagram.com/${encodeURIComponent(normalizedHandle)}/`;
  }
  if (normalizedChannel === 'telegram' && normalizedHandle) {
    return `https://t.me/${encodeURIComponent(normalizedHandle)}`;
  }
  if (normalizedChannel === 'facebook' && (normalizedHandle || rawHandle)) {
    if (rawHandle.startsWith('profile.php?id=')) {
      const id = rawHandle.slice('profile.php?id='.length);
      return id ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}` : null;
    }
    return `https://www.facebook.com/${encodeURIComponent(normalizedHandle || rawHandle)}`;
  }
  if (normalizedChannel === 'whatsapp') {
    const phoneDigits = String(normalizedHandle ?? phone ?? '').replace(/\D/g, '');
    if (WHATSAPP_PHONE.test(phoneDigits)) return `https://wa.me/${phoneDigits}`;
  }
  return null;
};

export const safeLeadChannelProfileUrl = (channel: string, value?: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const allowedHost = (
      channel === 'instagram'
      && ['instagram.com', 'www.instagram.com'].includes(host)
    ) || (
      channel === 'telegram'
      && ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(host)
    ) || (
      channel === 'facebook'
      && ['facebook.com', 'www.facebook.com', 'm.facebook.com'].includes(host)
    ) || (
      channel === 'whatsapp'
      && ['wa.me', 'www.wa.me', 'api.whatsapp.com'].includes(host)
    );
    return allowedHost ? url.toString() : null;
  } catch {
    return null;
  }
};

export const normalizeLeadSocialAccountValue = (
  channelValue: string,
  value: unknown,
): NormalizedLeadSocialAccount | null => {
  const channel = channelValue.trim().toLowerCase();
  if (!SOCIAL_CHANNEL_SET.has(channel)) return null;
  const typedChannel = channel as LeadChannelKind;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const url = parseSocialUrl(raw);

  let handle = '';
  if (typedChannel === 'instagram') {
    if (url) {
      if (!safeLeadChannelProfileUrl(typedChannel, url.toString())) return null;
      handle = firstPathSegment(url);
      if (NON_PROFILE_INSTAGRAM_PATHS.has(handle.toLowerCase())) return null;
    } else {
      handle = raw.replace(/^@+/, '').replace(/\/$/, '');
    }
    if (!INSTAGRAM_HANDLE.test(handle)) return null;
  } else if (typedChannel === 'telegram') {
    if (url) {
      if (!safeLeadChannelProfileUrl(typedChannel, url.toString())) return null;
      handle = firstPathSegment(url);
    } else {
      handle = raw.replace(/^@+/, '').replace(/\/$/, '');
    }
    if (!TELEGRAM_HANDLE.test(handle)) return null;
  } else if (typedChannel === 'facebook') {
    if (url) {
      if (!safeLeadChannelProfileUrl(typedChannel, url.toString())) return null;
      if (url.pathname.toLowerCase().replace(/\/$/, '') === '/profile.php') {
        const id = url.searchParams.get('id')?.trim() ?? '';
        if (!/^\d{3,30}$/.test(id)) return null;
        handle = `profile.php?id=${id}`;
      } else {
        handle = firstPathSegment(url);
        if (NON_PROFILE_FACEBOOK_PATHS.has(handle.toLowerCase())) return null;
      }
    } else {
      handle = raw.replace(/^@+/, '').replace(/\/$/, '');
    }
    if (!handle.startsWith('profile.php?id=') && !FACEBOOK_HANDLE.test(handle)) return null;
  } else {
    if (url) {
      if (!safeLeadChannelProfileUrl(typedChannel, url.toString())) return null;
      handle = url.hostname.toLowerCase().endsWith('whatsapp.com')
        ? url.searchParams.get('phone')?.replace(/\D/g, '') ?? ''
        : firstPathSegment(url).replace(/\D/g, '');
    } else {
      handle = raw.replace(/\D/g, '');
    }
    if (!WHATSAPP_PHONE.test(handle)) return null;
  }

  const profileUrl = buildLeadChannelProfileUrl(typedChannel, handle);
  if (!profileUrl) return null;
  return { channel: typedChannel, handle, profileUrl };
};
