import type {
  VoiceReminderAudio,
  VoiceReminderReadiness,
  VoiceReminderResult,
  VoiceReminderSettings,
  VoiceReminderSettingsInput,
  VoiceReminderStatus,
} from '@shared/contracts/voice-reminders';

export type StoredVoiceReminderAudio = VoiceReminderAudio & { storageKey: string; sha256: string };
export type VoiceReminderAudioUpload = { bytes: Buffer; originalName: string; mimeType: string };
export interface VoiceReminderAudioStore {
  save(upload: VoiceReminderAudioUpload): Promise<StoredVoiceReminderAudio>;
  resolve(storageKey: string): Promise<string>;
}

export type ClaimedVoiceReminder = {
  id: number;
  leaseToken: string;
  scheduledAt: Date;
  attempts: number;
};
export type PreparedVoiceReminder = ClaimedVoiceReminder & {
  phone: string;
  audio: StoredVoiceReminderAudio;
};
export type VoiceReminderCallOutcome = 'played' | 'unanswered' | 'failed' | 'busy' | 'cancelled';
export type VoiceReminderCallResult = {
  outcome: VoiceReminderCallOutcome;
  callStarted: boolean;
  callId: string | null;
  terminationConfirmed?: boolean;
};
export interface VoiceReminderLine {
  call(input: {
    jobId: number;
    jobLeaseToken?: string;
    phone: string;
    audioPath: string;
    deadline: Date;
    shouldContinue: () => Promise<boolean>;
  }): Promise<VoiceReminderCallResult>;
  release(): Promise<void>;
}
export interface VoiceReminderGateway {
  readiness(): Promise<VoiceReminderReadiness>;
  tryAcquireLine(): Promise<VoiceReminderLine | null>;
}

export interface VoiceReminderRepository {
  settings(): Promise<VoiceReminderSettings>;
  saveSettings(input: VoiceReminderSettingsInput, actorId: number): Promise<void>;
  currentAudio(): Promise<StoredVoiceReminderAudio | null>;
  saveAudio(audio: StoredVoiceReminderAudio, actorId: number): Promise<void>;
  results(): Promise<{ summary: Record<VoiceReminderStatus, number>; results: VoiceReminderResult[] }>;
  synchronize(now: Date, settings: VoiceReminderSettings): Promise<void>;
  claim(now: Date, maximum: number, leaseSeconds: number): Promise<ClaimedVoiceReminder | null>;
  prepare(job: ClaimedVoiceReminder, now: Date): Promise<PreparedVoiceReminder | 'defer' | null>;
  canContinue(job: ClaimedVoiceReminder, phone: string, now: Date): Promise<boolean>;
  renew(job: ClaimedVoiceReminder, now: Date, leaseSeconds: number): Promise<boolean>;
  finish(job: ClaimedVoiceReminder, result: VoiceReminderCallResult, now: Date, retryAt: Date | null): Promise<void>;
  defer(job: ClaimedVoiceReminder, now: Date): Promise<void>;
}
