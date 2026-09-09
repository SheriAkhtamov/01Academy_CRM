export type SalesDemoVisit = {
  participantId: number;
  demoId: number;
  scheduledAt: string;
  durationMinutes: number;
  format: 'offline' | 'online';
  courseName: string;
  schoolName: string;
  roomName: string | null;
  teacherName: string;
};

/** One student, with every recorded demo attendance in the selected period. */
export type SalesDemoStudent = {
  studentId: number;
  leadId: number | null;
  studentName: string | null;
  contactName: string | null;
  phone: string | null;
  managerId: number | null;
  managerName: string | null;
  visits: SalesDemoVisit[];
};
