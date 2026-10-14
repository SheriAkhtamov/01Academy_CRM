import type {
  VoiceReminderAudio,
  VoiceReminderAudioLibraryOf,
  VoiceReminderAudioPartsOf,
  VoiceReminderReadiness,
  VoiceReminderKind,
  VoiceReminderResponse,
  VoiceReminderSettings,
  VoiceReminderSettingsInput,
  VoiceReminderTestCall,
  VoiceReminderTestCallInput,
} from '@shared/contracts/voice-reminders';

export type StoredVoiceReminderAudio = VoiceReminderAudio & { storageKey: string; sha256: string };
export type VoiceReminderAudioUpload = { bytes: Buffer; originalName: string; mimeType: string };
export interface VoiceReminderAudioStore {
  save(upload: VoiceReminderAudioUpload): Promise<StoredVoiceReminderAudio>;
  resolve(storageKey: string): Promise<string>;
}
export type StoredVoiceReminderAudioLibrary = VoiceReminderAudioLibraryOf<StoredVoiceReminderAudio>;
export type VoiceReminderAudioTarget = { part: 'intro' | 'dayBeforeIntro' | 'outro' | 'confirmationYes' | 'confirmationNo' } | { part: 'time'; time: string }
  | { part: 'hour'; hour: string } | { part: 'minute'; minute: string };
export type VoiceReminderLibraryEntryTarget = Exclude<VoiceReminderAudioTarget, { part: 'intro' | 'dayBeforeIntro' | 'outro' | 'confirmationYes' | 'confirmationNo' }>;
export type StoredVoiceReminderAudioParts = VoiceReminderAudioPartsOf<StoredVoiceReminderAudio>;
export type StoredVoiceReminderConfirmation = {
  yesAudio: StoredVoiceReminderAudio;
  noAudio: StoredVoiceReminderAudio;
  promptDurationSeconds: number;
};
export interface VoiceReminderAudioComposer {
  compose(parts: StoredVoiceReminderAudioParts): Promise<{ path: string; mimeType: 'audio/wav' }>;
}

export type ClaimedVoiceReminder = {
  id: number;
  leaseToken: string;
  scheduledAt: Date;
  attempts: number;
  reminderKind: VoiceReminderKind;
};
export type PreparedVoiceReminder = ClaimedVoiceReminder & {
  deadline: Date;
  phone: string;
  audioParts: StoredVoiceReminderAudioParts;
  confirmation: StoredVoiceReminderConfirmation | null;
};
export type VoiceReminderCallOutcome = 'played' | 'unanswered' | 'failed' | 'busy' | 'cancelled';
export type VoiceReminderCallResult = {
  outcome: VoiceReminderCallOutcome;
  callStarted: boolean;
  callId: string | null;
  terminationConfirmed?: boolean;
  response?: VoiceReminderResponse;
};
export interface VoiceReminderLine {
  call(input: ({ jobId: number; jobLeaseToken?: string } | { testCallId: string; testLeaseToken: string }) & {
    phone: string;
    audioPath: string;
    deadline: Date;
    confirmation?: StoredVoiceReminderConfirmation & {
      onResponse: (response: VoiceReminderResponse, callId: string) => Promise<boolean>;
    };
    shouldContinue: (verifyAudio?: boolean) => Promise<boolean>;
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
  audioLibrary(): Promise<StoredVoiceReminderAudioLibrary>;
  saveLibraryAudio(target: VoiceReminderAudioTarget, audio: StoredVoiceReminderAudio, actorId: number, expectedAudioId?: string | null): Promise<void>;
  removeTimeAudio(time: string, actorId: number, expectedAudioId?: string): Promise<void>;
  removeLibraryAudio(target: VoiceReminderLibraryEntryTarget, actorId: number, expectedAudioId?: string): Promise<void>;
  synchronize(now: Date, settings: VoiceReminderSettings): Promise<void>;
  claim(now: Date, maximum: number, leaseSeconds: number): Promise<ClaimedVoiceReminder | null>;
  prepare(job: ClaimedVoiceReminder, now: Date): Promise<PreparedVoiceReminder | 'defer' | null>;
  canContinue(job: ClaimedVoiceReminder, phone: string, now: Date, verifyAudio?: boolean): Promise<boolean>;
  recordResponse(job: ClaimedVoiceReminder, phone: string, response: VoiceReminderResponse, now: Date, callId: string): Promise<boolean>;
  renew(job: ClaimedVoiceReminder, now: Date, leaseSeconds: number): Promise<boolean>;
  finish(job: ClaimedVoiceReminder, result: VoiceReminderCallResult, now: Date, retryAt: Date | null): Promise<void>;
  defer(job: ClaimedVoiceReminder, now: Date): Promise<void>;
}

export type ClaimedVoiceReminderTestCall = {
  id: string;
  actorUserId: number;
  leaseToken: string;
  expiresAt: Date;
  reminderKind: VoiceReminderKind;
};
export type PreparedVoiceReminderTestCall = ClaimedVoiceReminderTestCall & {
  phone: string;
  clockTime: string;
  audioParts: StoredVoiceReminderAudioParts;
  confirmation: StoredVoiceReminderConfirmation | null;
};
export interface VoiceReminderTestCallRepository {
  enqueue(actorId: number, input: VoiceReminderTestCallInput, now: Date, expiresAt: Date): Promise<VoiceReminderTestCall>;
  current(actorId: number): Promise<VoiceReminderTestCall | null>;
  recover(now: Date): Promise<void>;
  claim(now: Date, leaseSeconds: number): Promise<ClaimedVoiceReminderTestCall | null>;
  prepare(job: ClaimedVoiceReminderTestCall, now: Date): Promise<PreparedVoiceReminderTestCall | 'defer' | null>;
  canContinue(job: ClaimedVoiceReminderTestCall, now: Date, verifyAudio?: boolean): Promise<boolean>;
  recordResponse(job: ClaimedVoiceReminderTestCall, phone: string, response: VoiceReminderResponse, now: Date, callId: string): Promise<boolean>;
  renew(job: ClaimedVoiceReminderTestCall, now: Date, leaseSeconds: number): Promise<boolean>;
  finish(job: ClaimedVoiceReminderTestCall, result: VoiceReminderCallResult, now: Date): Promise<void>;
  defer(job: ClaimedVoiceReminderTestCall, now: Date): Promise<boolean>;
}
