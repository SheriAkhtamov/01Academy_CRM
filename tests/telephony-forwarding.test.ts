import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ONLINE_PBX_DEFAULT_FORWARDING_NUMBER,
  ONLINE_PBX_RING_GROUP,
  ONLINE_PBX_TRUNK_NUMBER,
  findOnlinePbxForwardingMember,
  setOnlinePbxForwardingMember,
} from '../shared/telephony';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('OnlinePBX forwarding settings', () => {
  it('adds, replaces, and removes only the configured mobile forwarding member', () => {
    expect(ONLINE_PBX_RING_GROUP).toBe('10');
    expect(ONLINE_PBX_DEFAULT_FORWARDING_NUMBER).toBe('+998978576040');
    expect(ONLINE_PBX_TRUNK_NUMBER).toBe('998787070171');
    expect(setOnlinePbxForwardingMember(['100'], {
      enabled: true,
      phone: '+998978576040',
    }))
      .toEqual(['100', '998978576040']);
    expect(setOnlinePbxForwardingMember(['100', '+998 97 857 60 40'], {
      enabled: false,
      phone: '+998978576040',
      previousPhone: '+998978576040',
    }))
      .toEqual(['100']);
    expect(setOnlinePbxForwardingMember(['100', '998978576040'], {
      enabled: true,
      phone: '+998901234567',
      previousPhone: '998978576040',
    }))
      .toEqual(['100', '998901234567']);
    expect(findOnlinePbxForwardingMember(['100', '998901234567'], '+998978576040'))
      .toBe('998901234567');
  });

  it('keeps forwarding controls in Administration integrations, not the phone widget', () => {
    const integrationsPage = fs.readFileSync(
      path.join(repositoryRoot, 'client/src/pages/academy.tsx'),
      'utf8',
    );
    const phoneWidget = fs.readFileSync(
      path.join(repositoryRoot, 'client/src/components/telephony/TelephonyWidget.tsx'),
      'utf8',
    );

    expect(integrationsPage).toContain("queryKey: ['/api/telephony/forwarding']");
    expect(integrationsPage).toContain('onlinePbxSettingsOpen');
    expect(integrationsPage).toContain("t('onlinePbxTestConnection')");
    expect(integrationsPage).toContain('online-pbx-forwarding-phone');
    expect(integrationsPage).toContain('updateOnlinePbxForwarding.mutate(onlinePbxForwardingDraft)');
    expect(phoneWidget).not.toContain('/api/telephony/forwarding');
  });

  it('protects the global setting and records changes in the audit log', () => {
    const route = fs.readFileSync(
      path.join(repositoryRoot, 'server/routes/telephony.routes.ts'),
      'utf8',
    );

    expect(route).toContain("router.get('/forwarding', requireAuth");
    expect(route).toContain("router.put('/forwarding', requireAuth");
    expect(route).toContain('hasLeadershipAccess(req.user)');
    expect(route).toContain('UPDATE_TELEPHONY_FORWARDING');
    expect(route).toContain('online_pbx_forwarding_phone');
    expect(route).toContain('onlinePbxForwardingLoop');
  });
});
