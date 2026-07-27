export const MIN_PASSWORD_CHARACTERS = 12;
export const MAX_PASSWORD_BYTES = 72;

export const getPasswordPolicyError = (
  password: string,
): 'passwordTooShort' | 'passwordTooLong' | null => {
  if (password.length < MIN_PASSWORD_CHARACTERS) {
    return 'passwordTooShort';
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return 'passwordTooLong';
  }
  return null;
};

export const isPasswordWithinBcryptLimit = (password: string) =>
  Buffer.byteLength(password, 'utf8') <= MAX_PASSWORD_BYTES;
