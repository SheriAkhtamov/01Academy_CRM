# Group profile and shared media

Reference: Telegram group profile, adapted to CRM Dialogs. Side conversation; no agents or browser checks authorized. The user supplied the required server access and authorized publication; the reviewed patch is integrated into main.

Scope: group detail/management Dialogs; group photo upload, cropping, preview, confirmed removal; photos/video/audio/GIF/files/links from existing messages; roster and existing membership controls; group avatars in chat header/list; authenticated file serving; translations and focused tests. Shared dependencies: profile crop Dialog title, media byte detection, direct/group attachment rendering and serving.

Decisions: centered photo/name/count; management opens a nested Dialog; media categories show actual counts and open a tabbed Dialog; image viewer has previous/next controls; audio/video use native playback; HTTP(S) links only. Owners/CRM leadership who belong to the group manage it; all members view media and leave through confirmation. No dummy controls or unimplemented polls/voice recording. All UI text uses RU/EN translations, no teaching or technical hints.

Acceptance: atomic profile save; confirmed photo/member removal; unsaved changes guarded; no private media/photo access for non-members; upload limits and actual byte MIME checks; immutable photo paths and backup-compatible retention; group/photo identity cannot be forged; live cache updates; safe URLs; modal/mobile overflow; membership/transfer behavior preserved. Scoped tests, TypeScript, i18n, lint, architecture and diff checks. New additive avatar_url migration is authorized for the normal deployment pipeline after full CI succeeds.
