export type GroupDeliveryMode = 'offline' | 'online';
export type GroupTrainingType = 'GRP' | 'IND';

export interface GroupCodeCatalogue {
  schoolCodes: Record<string, string>;
  courseCodes: Record<string, string>;
  nextNumber: number;
  year: string;
}

const groupCodePattern = /^([A-Z0-9]+)-([A-Z0-9]+)-(GRP|IND)-(\d{2})-(\d+)(?=$|\s)/;

export function parseGroupName(name: string | null | undefined) {
  const match = groupCodePattern.exec(String(name ?? '').trim());
  if (!match) return null;
  const number = Number(match[5]);
  if (!Number.isSafeInteger(number) || number < 1) return null;
  return {
    code: match[0], branch: match[1], course: match[2],
    trainingType: match[3] as GroupTrainingType,
    deliveryMode: (match[1] === 'ONL' ? 'online' : 'offline') as GroupDeliveryMode,
    year: match[4], number,
    addition: String(name).trim().slice(match[0].length).replace(/^\s*[—–-]?\s*/, '').trim(),
  };
}

export function composeGroupName(code: string, addition: string) {
  return addition.trim() ? `${code} — ${addition.trim()}` : code;
}

export function previewGroupCode(catalogue: GroupCodeCatalogue, input: {
  schoolId: string | number; courseId: string | number;
  deliveryMode: GroupDeliveryMode; trainingType: GroupTrainingType;
}) {
  const branch = input.deliveryMode === 'online' ? 'ONL' : catalogue.schoolCodes[String(input.schoolId)];
  const course = catalogue.courseCodes[String(input.courseId)];
  if (!branch || !course) return '';
  return `${branch}-${course}-${input.trainingType}-${catalogue.year}-${String(catalogue.nextNumber).padStart(4, '0')}`;
}
