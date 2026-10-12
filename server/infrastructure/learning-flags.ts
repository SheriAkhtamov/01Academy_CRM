import type { Pool } from 'pg';
import type { AppConfig } from '../config';
import { LEARNING_FLAG_KEYS, type LearningCapabilitiesDto, type LearningFlagDto, type LearningFlagKey, type LearningFlagUpdateInput, type LearningRolloutDto } from '@shared/contracts/learning-rollout';
import { PortalResourceError } from '../modules/portal-resources/domain/policy';
import { DEFAULT_LEARNING_SCHOOL_SETTINGS, fixedLearningPolicy, learningSchoolSettingsSchema, type LearningSchoolSettings, type LearningSchoolSettingsDto, type LearningSchoolSettingsUpdate } from '@shared/contracts/learning-settings';

export class LearningFeatureController {
  private values: LearningFlagDto[] = LEARNING_FLAG_KEYS.map((key) => ({ key, enabled: false, allGroups: false, groupIds: [], updatedAt: null,version:0 }));
  private school = structuredClone(DEFAULT_LEARNING_SCHOOL_SETTINGS);
  private schoolVersion = 0;
  private available = false;
  constructor(private readonly pool: Pool, private readonly config: AppConfig) {}
  async refresh() {
    if (!this.config.portal?.enabled) return;
    try {
    const rows = (await this.pool.query<{ key: LearningFlagKey; enabled: boolean; all_groups: boolean; group_ids: number[]; updated_at: Date;version:number }>('SELECT key,enabled,all_groups,group_ids,updated_at,version FROM lms_feature_flags')).rows;
    this.values = rows.map((row) => ({ key: row.key, enabled: row.enabled, allGroups: row.all_groups, groupIds: row.group_ids, updatedAt: row.updated_at.toISOString(),version:row.version }));
    const configured = (await this.pool.query<{ settings: unknown;version:number;updated_by:number|null }>('SELECT settings,version,updated_by FROM lms_school_settings WHERE singleton=true')).rows[0];
    if (configured) {
      this.school = fixedLearningPolicy(learningSchoolSettingsSchema.parse(configured.settings));
      this.schoolVersion = configured.version;
    }
    this.available = true;
    } catch(error) {
      this.available = false;
      throw error;
    }
  }
  settings(): LearningSchoolSettings { return this.school; }
  async settingsConfiguration(): Promise<LearningSchoolSettingsDto> {
    const employees = (await this.pool.query<{ id: number; full_name: string }>("SELECT id,full_name FROM users WHERE is_active=true AND is_archived=false ORDER BY full_name,id")).rows.map(row => ({ id: row.id, fullName: row.full_name }));
    return { settings: this.school,version:this.schoolVersion,employees };
  }
  async updateSettings(actorId: number, input: LearningSchoolSettingsUpdate['settings'],version = this.schoolVersion,requestId?:string) {
    if (!this.config.portal?.enabled) throw new PortalResourceError('portalUnavailable',409);
    const sql = await this.pool.connect();
    try {
      await sql.query('BEGIN');
      await sql.query('SELECT pg_advisory_xact_lock(136037)');
      const existing = (await sql.query('SELECT settings,version FROM lms_school_settings WHERE singleton=true FOR UPDATE')).rows[0];
      if ((existing?.version ?? 0) !== version) throw new PortalResourceError('portalVersionConflict',409);
      const old = existing?.settings;
      const current = learningSchoolSettingsSchema.parse(old ?? DEFAULT_LEARNING_SCHOOL_SETTINGS);
      const updated = learningSchoolSettingsSchema.parse({...input,crmPreparation:input.crmPreparation ?? current.crmPreparation});
      await sql.query('INSERT INTO lms_school_settings(singleton,settings,updated_by,version) VALUES(true,$1::jsonb,$2,1) ON CONFLICT(singleton) DO UPDATE SET settings=EXCLUDED.settings,updated_by=EXCLUDED.updated_by,updated_at=now(),version=lms_school_settings.version+1', [JSON.stringify(updated),actorId]);
      await sql.query("INSERT INTO lms_learning_audit(user_id,entity_type,entity_id,action,old_value,new_value,request_id) VALUES($1,'school_settings',1,'settings.changed',$2::jsonb,$3::jsonb,$4)", [actorId,JSON.stringify(old ?? null),JSON.stringify(updated),requestId ?? null]);
      await sql.query('COMMIT');
    } catch(error) { await sql.query('ROLLBACK'); throw error; } finally { sql.release(); }
    await this.refresh();
    return this.settingsConfiguration();
  }
  capabilities(): LearningCapabilitiesDto {
    const portal = this.config.portal;
    const global = (key: LearningFlagKey) => Boolean(portal?.enabled && this.available && this.values.find((flag) => flag.key === key)?.enabled);
    return { portalEnabled: Boolean(portal?.enabled && this.available), learningEnabled: Boolean(portal?.learningEnabled && global('learning')),
      invitationsEnabled: Boolean(portal?.allowInvitations && global('invitations')),
      publicPortfolioEnabled: Boolean(portal?.publicPortfolioEnabled && global('public_portfolio')) };
  }
  async enabledForStudent(
    key: LearningFlagKey,
    studentId?: number,
    readEnrollmentGroups?: () => readonly number[] | Promise<readonly number[]>,
  ): Promise<boolean> {
    const capabilities = this.capabilities();
    const enabled = { learning: capabilities.learningEnabled, invitations: capabilities.invitationsEnabled, public_portfolio: capabilities.publicPortfolioEnabled }[key];
    if (!enabled) return false;
    const flag = this.values.find((value) => value.key === key)!;
    if (studentId === undefined) return flag.allGroups || flag.groupIds.length > 0;
    const restrictions = this.config.portal?.groupIds ?? [];
    // Whole-academy rollout includes pupils awaiting enrollment, so membership cannot change this decision.
    if (flag.allGroups && !restrictions.length) return true;
    if (readEnrollmentGroups) {
      const groupIds = await readEnrollmentGroups();
      return groupIds.some((groupId) =>
        (flag.allGroups || flag.groupIds.includes(groupId)) &&
        (!restrictions.length || restrictions.includes(groupId)),
      );
    }
    const result = await this.pool.query<{ allowed: boolean }>(`SELECT EXISTS(SELECT 1 FROM academy_student_group_enrollments enrollment
      WHERE enrollment.student_id=$1 AND ($2::boolean OR enrollment.group_id=ANY($3::integer[]))
      AND ($4::integer[]='{}' OR enrollment.group_id=ANY($4::integer[]))) AS allowed`, [studentId, flag.allGroups, flag.groupIds, restrictions]);
    // An explicit whole-academy rollout also covers pupils awaiting their first enrollment.
    return Boolean(result.rows[0]?.allowed);
  }
  async enabledForGroup(key: LearningFlagKey, groupId: number): Promise<boolean> {
    const flag = this.values.find((value) => value.key === key);
    if (!await this.enabledForStudent(key)) return false;
    const restrictions = this.config.portal?.groupIds ?? [];
    return Boolean(flag && (flag.allGroups || flag.groupIds.includes(groupId)) && (!restrictions.length || restrictions.includes(groupId)));
  }
  async configuration(): Promise<LearningRolloutDto> {
    const groups = (await this.pool.query<{ id: number; name: string }>('SELECT id,name FROM academy_groups ORDER BY name,id')).rows;
    return { capabilities: this.capabilities(), flags: this.values, groups };
  }
  async update(actorId: number, input: LearningFlagUpdateInput,requestId?:string) {
    if (!this.config.portal?.enabled) throw new PortalResourceError('portalUnavailable', 409);
    const groups = await this.pool.query('SELECT id FROM academy_groups WHERE id=ANY($1::integer[])', [input.groupIds]);
    if (groups.rowCount !== input.groupIds.length) throw new PortalResourceError('portalInvalidData');
    const keyEnabled = { learning: this.config.portal.learningEnabled, invitations: this.config.portal.allowInvitations, public_portfolio: this.config.portal.publicPortfolioEnabled }[input.key];
    if (input.enabled && !keyEnabled) throw new PortalResourceError('portalUnavailable', 409);
    const sql = await this.pool.connect();
    try {
      await sql.query('BEGIN');
      const old = (await sql.query('SELECT key,enabled,all_groups,group_ids,version FROM lms_feature_flags WHERE key=$1 FOR UPDATE',[input.key])).rows[0];
      if (!old || old.version !== input.version) throw new PortalResourceError('portalVersionConflict',409);
      await sql.query(`UPDATE lms_feature_flags SET enabled=$2,all_groups=$3,group_ids=$4,updated_by=$5,updated_at=now(),version=version+1 WHERE key=$1`, [input.key, input.enabled, input.allGroups, input.groupIds, actorId]);
      await sql.query("INSERT INTO lms_learning_audit(user_id,entity_type,entity_id,action,old_value,new_value,request_id) VALUES($1,'feature_flag',0,'flag.changed',$2::jsonb,$3::jsonb,$4)",[actorId,JSON.stringify(old),JSON.stringify(input),requestId ?? null]);
      await sql.query('COMMIT');
    } catch(error) { await sql.query('ROLLBACK'); throw error; } finally { sql.release(); }
    await this.refresh();
    return this.configuration();
  }
}
