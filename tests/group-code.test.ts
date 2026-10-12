import { describe, expect, it } from 'vitest';
import { preserveGroupCode } from '../server/modules/academy/group-code';
import { composeGroupName, parseGroupName, previewGroupCode } from '../shared/academy-group-code';

describe('protected group identity', () => {
  const row = { name: 'CYP-AI-GRP-26-0035 — Earlier' };
  it('keeps the code while changing the addition, course or classroom', () => {
    const values = { name: row.name, courseId: 5, roomId: 15 };
    preserveGroupCode(row, values, { nameSuffix: 'Morning' });
    expect(values.name).toBe('CYP-AI-GRP-26-0035 — Morning');
  });
  it('supports no name addition and parses the existing delivery and training type', () => {
    const values = { name: row.name };
    preserveGroupCode(row, values, { nameSuffix: '' });
    expect(values.name).toBe('CYP-AI-GRP-26-0035');
    expect(parseGroupName('ONL-VC-IND-26-0043 — Personal')).toMatchObject({ deliveryMode: 'online', trainingType: 'IND', addition: 'Personal', number: 43 });
    expect(parseGroupName('CYP-3D-GRP-25-0099')).toMatchObject({ course: '3D', number: 99 });
    expect(composeGroupName(values.name, '  Morning  ')).toBe(`${values.name} — Morning`);
  });
  it.each(['CYP-AI-GRP-26-9999', 'Arbitrary name', null])('rejects manual removal or replacement of an existing code: %s', (name) => {
    expect(() => preserveGroupCode(row, { name }, {})).toThrow('groupCodeImmutable');
  });
  it('requires a new group for permanent online conversion and rejects a changed training type', () => {
    expect(() => preserveGroupCode(row, {}, { deliveryMode: 'online' })).toThrow('groupOnlineRequiresNewGroup');
    expect(() => preserveGroupCode(row, {}, { trainingType: 'IND' })).toThrow('groupCodeImmutable');
  });
  it('does not allow a legacy name edit to introduce an arbitrary group code', () => {
    expect(() => preserveGroupCode({ name: 'Legacy' }, { name: 'CYP-AI-GRP-26-0035' }, {})).toThrow('groupNameAdditionInvalid');
  });
  it('previews online codes independently of the physical branch and uses an approved course code', () => {
    const catalogue = { schoolCodes: { 1: 'CYP' }, courseCodes: { 2: 'VC' }, nextNumber: 44, year: '26' };
    expect(previewGroupCode(catalogue, { schoolId: 9, courseId: 2, deliveryMode: 'online', trainingType: 'IND' })).toBe('ONL-VC-IND-26-0044');
    expect(previewGroupCode(catalogue, { schoolId: 9, courseId: 2, deliveryMode: 'offline', trainingType: 'GRP' })).toBe('');
  });
});
