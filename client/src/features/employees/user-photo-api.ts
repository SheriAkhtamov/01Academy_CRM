export const withUserPhoto = (profile: unknown, photo?: File | null) => {
  if (!photo) return profile;
  const form = new FormData();
  form.append('profile', JSON.stringify(profile));
  form.append('photo', photo);
  return form;
};
