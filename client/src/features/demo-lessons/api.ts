import type {
  DemoLessonAttendance,
  DemoLessonEnrollment,
  DemoLessonMutation,
  DemoNoShowReasonCode,
  DemoLessonResourceAvailabilityRequest,
} from '@shared/contracts/demo-lessons';
import { apiRequest } from '@/lib/queryClient';

export interface DemoLessonParticipant {
  id: number;
  leadId: number;
  status: 'invited' | 'confirmed' | 'attended' | 'no_show' | 'cancelled';
  result?: string | null;
  noShowReasonCode?: DemoNoShowReasonCode | null;
  noShowReasonNote?: string | null;
  contactName?: string | null;
  studentName?: string | null;
  managerId?: number | null;
}

export interface DemoLesson {
  id: number;
  courseId: number;
  courseName?: string | null;
  schoolId: number;
  schoolName?: string | null;
  roomId?: number | null;
  roomName?: string | null;
  teacherId: number;
  teacherName?: string | null;
  scheduledAt: string;
  durationMinutes: number;
  format: 'offline' | 'online';
  status: 'scheduled' | 'completed' | 'cancelled';
  notes?: string | null;
  cancellationReason?: string | null;
  participants: DemoLessonParticipant[];
  canManage?: boolean;
}

export interface AvailabilitySlot {
  startsAt: string;
  endsAt: string;
  teacherId: number;
  teacherName: string;
  roomId?: number | null;
  roomName?: string | null;
  roomCapacity?: number | null;
  availableTeacherCount: number;
  availableRoomCount: number;
  availableOptionCount: number;
}

export interface AvailabilityResponse {
  durationMinutes: number;
  format: 'offline' | 'online';
  slots: AvailabilitySlot[];
}

export interface DemoResourceAvailability {
  teachers: Array<{
    id: number;
    fullName: string;
    status: string;
    available: boolean;
    reason: 'busy' | 'inactive' | null;
  }>;
  rooms: Array<{
    id: number;
    name: string;
    schoolId: number;
    isActive: boolean;
    available: boolean;
    reason: 'busy' | 'inactive' | null;
  }>;
  participantConflict: boolean;
}

export const demoLessonQueryKeys = {
  all: ['/api/academy/demo-lessons'] as const,
  availability: ['/api/academy/availability/slots'] as const,
  resourceAvailability: ['/api/academy/demo-lessons/resource-availability'] as const,
  enrollment: ['/api/academy/demo-lessons', 'enrollment'] as const,
};

export const demoLessonsApi = {
  list: (params: { from: string; to: string; schoolId?: number | null }) => {
    const query = new URLSearchParams({ from: params.from, to: params.to });
    if (params.schoolId) query.set('schoolId', String(params.schoolId));
    return apiRequest('GET', `/api/academy/demo-lessons?${query.toString()}`) as Promise<DemoLesson[]>;
  },
  listUpcoming: () => {
    const query = new URLSearchParams({
      from: new Date().toISOString(),
      upcoming: 'true',
    });
    return apiRequest('GET', `/api/academy/demo-lessons?${query.toString()}`) as Promise<DemoLesson[]>;
  },
  availability: (params: {
    schoolId: number;
    courseId: number;
    from: string;
    days?: number;
    format?: 'offline' | 'online';
    participantIds?: number[];
    excludeLeadId?: number | null;
    excludeDemoLessonId?: number | null;
  }) => {
    const query = new URLSearchParams({
      schoolId: String(params.schoolId),
      courseId: String(params.courseId),
      from: params.from,
      days: String(params.days ?? 7),
      format: params.format ?? 'offline',
    });
    if (params.excludeLeadId) query.set('excludeLeadId', String(params.excludeLeadId));
    if (params.excludeDemoLessonId) query.set('excludeDemoLessonId', String(params.excludeDemoLessonId));
    if (params.participantIds?.length) query.set('participantIds', params.participantIds.join(','));
    return apiRequest('GET', `/api/academy/availability/slots?${query.toString()}`) as Promise<AvailabilityResponse>;
  },
  create: (payload: DemoLessonMutation) => (
    apiRequest('POST', '/api/academy/demo-lessons', payload) as Promise<DemoLesson>
  ),
  enroll: (id: number, payload: DemoLessonEnrollment) => (
    apiRequest('POST', `/api/academy/demo-lessons/${id}/participants`, payload) as Promise<DemoLesson>
  ),
  resourceAvailability: (payload: DemoLessonResourceAvailabilityRequest) => (
    apiRequest('POST', '/api/academy/demo-lessons/resource-availability', payload) as Promise<DemoResourceAvailability>
  ),
  cancel: (id: number, reason: string) => (
    apiRequest('POST', `/api/academy/demo-lessons/${id}/cancel`, { reason }) as Promise<DemoLesson>
  ),
  saveAttendance: (id: number, payload: DemoLessonAttendance) => (
    apiRequest('POST', `/api/academy/demo-lessons/${id}/attendance`, payload) as Promise<DemoLesson>
  ),
};
