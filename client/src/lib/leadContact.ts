export interface LeadContactFields {
  id?: number | null;
  phone?: string | null;
  phoneNumbers?: string[] | null;
  messenger?: string | null;
  sourceName?: string | null;
  sourceChannel?: string | null;
}

export interface LeadMessageTarget {
  href: string;
  external: boolean;
}

export const isSyntheticInstagramPhone = (value?: string | null) =>
  Boolean(value && value.startsWith('instagram:'));

export const isInstagramLead = (lead?: LeadContactFields | null) => {
  if (!lead) return false;
  const channel = String(lead.sourceChannel ?? '').trim().toLowerCase();
  const sourceName = String(lead.sourceName ?? '').trim().toLowerCase();
  return channel === 'instagram'
    || sourceName.includes('instagram')
    || isSyntheticInstagramPhone(lead.phone)
    || (lead.phoneNumbers ?? []).some(isSyntheticInstagramPhone);
};

export const visibleLeadPhones = (lead?: LeadContactFields | null) => {
  if (!lead) return [];
  const values = lead.phoneNumbers?.length ? lead.phoneNumbers : lead.phone ? [lead.phone] : [];
  return values.filter((phone) => !isSyntheticInstagramPhone(phone));
};

export const primaryVisibleLeadPhone = (lead?: LeadContactFields | null) =>
  visibleLeadPhones(lead)[0] ?? null;

export const leadContactSummary = (lead?: LeadContactFields | null, fallback = '') => {
  if (!lead) return fallback;
  const phone = primaryVisibleLeadPhone(lead);
  if (phone) return phone;
  if (isInstagramLead(lead) && lead.messenger) return lead.messenger;
  return lead.messenger || fallback;
};

export const leadMessageTarget = (lead?: LeadContactFields | null): LeadMessageTarget | null => {
  if (!lead) return null;

  if (isInstagramLead(lead) && lead.id) {
    return { href: `/sales/messages?lead=${lead.id}`, external: false };
  }

  const messenger = lead.messenger?.trim();
  if (messenger?.startsWith('@')) {
    return { href: `https://t.me/${messenger.slice(1)}`, external: true };
  }

  const phone = primaryVisibleLeadPhone(lead);
  if (phone) {
    return { href: `https://wa.me/${phone.replace(/\D/g, '')}`, external: true };
  }

  return null;
};
