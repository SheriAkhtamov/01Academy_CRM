export const LEAD_LOCALITIES = [
  'bektemir',
  'chilanzar',
  'mirabad',
  'mirzo_ulugbek',
  'olmazor',
  'sergeli',
  'shaykhontohur',
  'uchtepa',
  'yakkasaray',
  'yangihayot',
  'yashnabad',
  'yunusabad',
  'region',
] as const;

export const LEAD_STUDY_DAYS = ['even', 'odd', 'weekend'] as const;
export const LEAD_STUDY_TIMES = Array.from(
  { length: 12 },
  (_, index) => `${String(index + 9).padStart(2, '0')}:00`,
);
