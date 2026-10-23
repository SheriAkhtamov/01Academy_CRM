/** The same identity is used for phone storage and its optional owner's name. */
export const leadPhoneIdentity = (value: string | null | undefined): string => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `998${digits}`;
  return digits ? `+${digits}` : '';
};

export const phoneOwnersFromRows = (phones: string[], names: string[] = []): Record<string, string> =>
  Object.fromEntries(phones.flatMap((phone, index) => {
    const identity = leadPhoneIdentity(phone);
    return identity ? [[identity, (names[index] ?? '').trim()]] : [];
  }));

export const phoneOwnerNamesFor = (phones: string[], owners: Record<string, string> = {}): string[] =>
  phones.map((phone) => owners[leadPhoneIdentity(phone)] ?? '');
