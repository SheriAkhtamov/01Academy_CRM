export const MAX_LEAD_TAG_NAME_LENGTH = 48;

export type LeadTagView = {
  id: number;
  tagId: number;
  name: string;
};

export type LeadTagOption = {
  id: number | null;
  name: string;
};

const LEAD_TAG_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export const normalizeLeadTagName = (value: unknown): {
  name: string;
  normalizedName: string;
} | null => {
  if (typeof value !== 'string') return null;
  const name = value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
  if (
    !name
    || Array.from(name).length > MAX_LEAD_TAG_NAME_LENGTH
    || LEAD_TAG_CONTROL_CHARACTERS.test(name)
  ) {
    return null;
  }
  return {
    name,
    normalizedName: name.toLocaleLowerCase('ru-RU'),
  };
};

export const leadTagNameKey = (value: unknown) =>
  normalizeLeadTagName(value)?.normalizedName ?? '';
