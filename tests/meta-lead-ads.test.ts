import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLeadImportComment } from '../server/services/lead-import';
import { mapMetaLeadToImportRecord } from '../server/services/meta-lead-ads';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Meta Instant Form lead ingestion', () => {
  it('maps standard contact fields and preserves every form answer', () => {
    const record = mapMetaLeadToImportRecord({
      id: 'lead-123',
      created_time: '2026-08-04T10:00:00+0000',
      campaign_id: 'campaign-1',
      campaign_name: 'August leads',
      adset_id: 'adset-1',
      adset_name: 'Parents',
      ad_id: 'ad-1',
      ad_name: '[РОБОТОТЕХНИКА] Reel',
      form_id: 'form-1',
      platform: 'instagram',
      is_organic: false,
      field_data: [
        { name: 'full_name', values: ['Ali Valiyev'] },
        { name: 'phone_number', values: ['+998 90 123 45 67'] },
        { name: 'Возраст ребёнка', values: ['9 лет'] },
        { name: 'Любимый предмет', values: ['Математика', 'Информатика'] },
      ],
      custom_disclaimer_responses: [
        { checkbox_key: 'marketing_consent', is_checked: '1' },
      ],
    }, {}, 'AI Kids form');

    expect(record).toMatchObject({
      externalId: 'lead-123',
      contactName: 'Ali Valiyev',
      phone: '+998901234567',
      studentAge: 9,
      formName: 'AI Kids form',
      campaignName: 'August leads',
      adName: '[РОБОТОТЕХНИКА] Reel',
      platform: 'instagram',
    });
    expect(record.answers).toHaveLength(4);

    const comment = buildLeadImportComment(record);
    expect(comment).not.toContain('Ali Valiyev');
    expect(comment).not.toMatch(/Телефон|Возраст/);
    expect(comment).toContain('Любимый предмет: Математика, Информатика');
    expect(comment).not.toMatch(/Импорт|August leads|Reel|AI Kids form|campaign-1|adset-1|ad-1|form-1|lead-123|instagram|marketing consent|2026-/);
    // Complete technical attribution and consent data stay available internally.
    expect(record.campaignId).toBe('campaign-1');
    expect(record.disclaimerResponses).toEqual([{ name: 'marketing_consent', value: '1' }]);
  });

  it('recognizes named Meta test leads when the API omits a test flag', () => {
    const record = mapMetaLeadToImportRecord({
      id: 'test-lead-123',
      form_id: 'form-1',
      field_data: [
        { name: 'full_name', values: ['Meta CRM Test Lead'] },
        { name: 'phone_number', values: ['+998900000000'] },
      ],
    });

    expect(record.test).toBe(true);
    expect(record.contactName).toBe('Meta CRM Test Lead');
  });

  it('maps localized questions and all phone values while retaining the original Meta submission', () => {
    const lead = { id: 'localized-lead', field_data: [
      { name: 'Ism_va_familiyangiz', values: ['Sevara Aliyeva'] },
      { name: 'Telefon_raqamingiz', values: ['1991', '+998901234567', '+998911234567'] },
      { name: 'farzandingiz_nechchi_yoshda?', values: ['8🏰'] },
      { name: 'qaysi_shahardansiz?', values: ['toshkent'] },
    ] };
    const record = mapMetaLeadToImportRecord(lead);
    expect(record).toMatchObject({ contactName: 'Sevara Aliyeva', phone: '+998901234567', rawPhone: '1991',
      phoneNumbers: ['+998901234567', '+998911234567'], studentAge: 8, locality: null, rawMetaLead: lead });
    expect(buildLeadImportComment(record)).toBe('Telefon raqamingiz: 1991\nqaysi shahardansiz?: toshkent');
    expect(record.answers).toEqual(lead.field_data.map(field => ({ name: field.name, values: field.values })));
  });

  it('maps an adult learner age while keeping a parent age out of the child age field', () => {
    const parentAge = { name: 'сколько_вам_лет?', values: ['35'] };
    const adult = mapMetaLeadToImportRecord({ id: 'adult', field_data: [parentAge] });
    expect(adult).toMatchObject({ studentAge: 35, childAgeAnswer: '35' });
    const child = mapMetaLeadToImportRecord({ id: 'child', field_data: [parentAge,
      { name: 'сколько_лет_вашему_ребенку?', values: ['8'] },
    ] });
    expect(child).toMatchObject({ studentAge: 8, childAgeAnswer: '8' });
    expect(buildLeadImportComment(child)).toBe('сколько вам лет?: 35');
  });

  it('ships a signed Page webhook and Instant Form attribution schema', () => {
    const routes = read('../server/routes/incoming.routes.ts');
    const httpApp = read('../server/app/http-app.ts');
    const migration = read('../migrations/0076_add_meta_instant_form_attribution.sql');
    const exampleConfig = read('../config/app.config.example.json');

    expect(routes).toContain("router.get('/meta-leads'");
    expect(routes).toContain("router.post('/meta-leads'");
    expect(routes).toContain('verifyMetaLeadWebhookSignature(req.rawBody, signature)');
    expect(httpApp).toContain("request.originalUrl.startsWith('/api/incoming/meta-leads')");
    expect(migration).toContain('ALTER COLUMN "conversation_id" DROP NOT NULL');
    expect(migration).toContain('"leadgen_id" varchar(255)');
    expect(migration).toContain('"meta_lead_attributions_leadgen_touch_unique"');
    expect(exampleConfig).toContain('"leadAccessToken": ""');
    expect(exampleConfig).toContain('"leadWebhookVerifyToken"');
  });

});
