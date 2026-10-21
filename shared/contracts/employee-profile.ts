import type { AcademyAccessModule } from '../academy';
import type { EmployeeIdentity } from './employee-identity';

export type EmployeeProfile = EmployeeIdentity & {
  position: string | null;
  modules: AcademyAccessModule[];
  phoneNumbers: string[];
  isArchived: boolean;
};
