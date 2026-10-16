export const withUserPhoto = <T,>(profile: T, photo?: File | null): T | FormData => {
  if (!photo) return profile;
  const form = new FormData();
  form.append('profile', JSON.stringify(profile));
  form.append('photo', photo);
  return form;
};
