type InstagramLeadIdentity = {
  name?: unknown;
  username?: unknown;
  messenger?: unknown;
};

const cleanIdentityText = (value: unknown, maxLength = 255) => {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, maxLength) : null;
};

export const isGeneratedInstagramLeadName = (value: unknown) => {
  const cleaned = cleanIdentityText(value);
  return Boolean(
    cleaned
    && (
      /^instagram(?:\s+lead)?$/i.test(cleaned)
      || /^instagram\s+#[0-9]+$/i.test(cleaned)
    )
  );
};

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
 * real profile name or handle. Returning null is intentional: a numeric
 * Instagram-scoped ID must never be presented to employees as a contact name.
 */
export const resolveInstagramLeadContactName = ({
  name,
  username,
  messenger,
}: InstagramLeadIdentity) => {
  const profileName = cleanIdentityText(name);
  if (profileName && !isGeneratedInstagramLeadName(profileName)) return profileName;

  const handle = instagramHandle(username) ?? instagramHandle(messenger);
  if (handle) return handle;

  return null;
};
