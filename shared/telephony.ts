export const ONLINE_PBX_EXTENSION_MIN = 100;
export const ONLINE_PBX_EXTENSION_MAX = 4999;

export const isOnlinePbxExtension = (value: unknown): value is string => {
  const text = String(value ?? '').trim();
  if (!/^\d{3,4}$/.test(text)) return false;
  const extension = Number(text);
  return Number.isInteger(extension)
    && extension >= ONLINE_PBX_EXTENSION_MIN
    && extension <= ONLINE_PBX_EXTENSION_MAX;
};
