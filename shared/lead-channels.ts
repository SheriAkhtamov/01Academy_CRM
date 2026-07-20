export const LEAD_CHANNELS = ['instagram', 'telegram', 'whatsapp'] as const;
export type LeadChannelKind = (typeof LEAD_CHANNELS)[number];

export interface LeadChannelView {
  id: number;
  channel: string;
  providerAccountId?: string | null;
  externalId?: string | null;
  handle?: string | null;
  displayName?: string | null;
  profileUrl?: string | null;
}

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
  const normalizedHandle = normalizeLeadChannelHandle(handle);
  if (normalizedChannel === 'instagram' && normalizedHandle) {
    return `https://www.instagram.com/${encodeURIComponent(normalizedHandle)}/`;
  }
  if (normalizedChannel === 'telegram' && normalizedHandle) {
    return `https://t.me/${encodeURIComponent(normalizedHandle)}`;
  }
  if (normalizedChannel === 'whatsapp') {
    const digits = String(phone ?? handle ?? '').replace(/\D/g, '');
    return digits ? `https://wa.me/${digits}` : null;
  }
  return null;
};

export const safeLeadChannelProfileUrl = (channel: string, value?: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const allowedHost = channel === 'instagram'
      ? ['instagram.com', 'www.instagram.com'].includes(host)
      : channel === 'telegram'
        ? ['t.me', 'telegram.me'].includes(host)
        : channel === 'whatsapp'
          ? ['wa.me', 'api.whatsapp.com'].includes(host)
          : false;
    return allowedHost ? url.toString() : null;
  } catch {
    return null;
  }
};
