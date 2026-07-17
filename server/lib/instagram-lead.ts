type InstagramLeadIdentity = {
  name?: unknown;
  username?: unknown;
  messenger?: unknown;
  participantId?: unknown;
  phone?: unknown;
};

const cleanIdentityText = (value: unknown, maxLength = 255) => {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, maxLength) : null;
};

const isGenericInstagramName = (value: string) => /^instagram\s+lead$/i.test(value);

const instagramHandle = (value: unknown) => {
  const cleaned = cleanIdentityText(value, 120);
  if (!cleaned || /^instagram:/i.test(cleaned)) return null;

  const withoutUrl = cleaned
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .replace(/^@+/, '');
  return withoutUrl ? `@${withoutUrl}`.slice(0, 255) : null;
};

/**
 * Produces a stable, readable CRM contact name for an Instagram identity.
 * Integrations sometimes send the literal placeholder "Instagram lead" with
 * trailing line breaks, so that value is deliberately ignored in favour of a
 * real profile name or handle.
 */
export const resolveInstagramLeadContactName = ({
  name,
  username,
  messenger,
  participantId,
  phone,
}: InstagramLeadIdentity) => {
  const profileName = cleanIdentityText(name);
  if (profileName && !isGenericInstagramName(profileName)) return profileName;

  const handle = instagramHandle(username) ?? instagramHandle(messenger);
  if (handle) return handle;

  const stableIdentity = cleanIdentityText(participantId, 220) ?? cleanIdentityText(phone, 220);
  return stableIdentity ? `Instagram #${stableIdentity}`.slice(0, 255) : 'Instagram';
};
