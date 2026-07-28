import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildOnlinePbxRingMembers,
  ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS,
  ONLINE_PBX_RING_GROUP,
  ONLINE_PBX_SHARED_EXTENSION,
  onlinePbxIncomingDelayMs,
  onlinePbxRoutingDestination,
} from '../shared/telephony';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('OnlinePBX CRM manager assignments', () => {
  it('uses the existing shared extension and delays only secondary CRM managers', () => {
    expect(ONLINE_PBX_RING_GROUP).toBe('10');
    expect(ONLINE_PBX_SHARED_EXTENSION).toBe('100');
    expect(ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS).toBe(3);
    expect(onlinePbxRoutingDestination('100')).toBe('100');
    expect(onlinePbxRoutingDestination('+998 90 123-45-67')).toBeNull();
    expect(onlinePbxIncomingDelayMs(7, 7)).toBe(0);
    expect(onlinePbxIncomingDelayMs(13, 7)).toBe(3_000);
  });

  it('rings only assigned online and registered CRM users and never forwards implicitly', () => {
    const candidates = [
      { id: 7, extension: '100', enabled: true, isOnline: true, isTelephonyReady: true },
      { id: 13, extension: '100', enabled: true, isOnline: true, isTelephonyReady: true },
      { id: 15, extension: '100', enabled: true, isOnline: false, isTelephonyReady: true },
      { id: 18, extension: '100', enabled: false, isOnline: true, isTelephonyReady: true },
      { id: 19, extension: '100', enabled: true, isOnline: true, isTelephonyReady: false },
    ];

    expect(buildOnlinePbxRingMembers(candidates, {
      enabled: false,
      phone: '+998 90 123 45 67',
    })).toEqual(['100']);
    expect(buildOnlinePbxRingMembers([], {
      enabled: false,
      phone: '+998 90 123 45 67',
    })).toEqual(['0']);
    expect(buildOnlinePbxRingMembers(candidates, {
      enabled: true,
      phone: '+998 90 123 45 67',
    })).toEqual(['100', '998901234567']);
  });

  it('keeps the rebuilt assignment and forwarding controls inside the OnlinePBX dialog', () => {
    const integrationsPage = fs.readFileSync(
      path.join(repositoryRoot, 'client/src/pages/academy.tsx'),
      'utf8',
    );

    expect(integrationsPage).toContain('<Dialog open={onlinePbxSettingsOpen}');
    expect(integrationsPage).toContain("t('onlinePbxAddManager')");
    expect(integrationsPage).toContain("t('onlinePbxExistingExtension')");
    expect(integrationsPage).toContain("t('onlinePbxForwardingTitle')");
    expect(integrationsPage).toContain('updateOnlinePbxRouting.mutate(onlinePbxRoutingDraft)');
    expect(integrationsPage).toContain('removeManagerTarget');
    expect(integrationsPage).not.toContain('testOnlinePbx');
  });

  it('validates extensions against the provider and contains no internal-number provisioning API', () => {
    const route = fs.readFileSync(
      path.join(repositoryRoot, 'server/routes/telephony.routes.ts'),
      'utf8',
    );
    const provider = fs.readFileSync(
      path.join(repositoryRoot, 'server/services/onlinepbx.ts'),
      'utf8',
    );
    const routingService = fs.readFileSync(
      path.join(repositoryRoot, 'server/services/telephony-routing.ts'),
      'utf8',
    );

    expect(route).toContain('existingExtensionNumbers.has(assignment.extension)');
    expect(route).toContain('online_pbx_incoming_enabled = true');
    expect(route).toContain('online_pbx_forwarding_enabled = $3');
    expect(route).toContain('UPDATE_TELEPHONY_ROUTING');
    expect(provider).not.toContain("'user/add'");
    expect(provider).not.toContain("'user/edit'");
    expect(provider).not.toContain("'group/add'");
    expect(provider).not.toContain('createExtension(');
    expect(provider).not.toContain('createGroup(');
    expect(routingService).toContain('manager.isOnline');
    expect(routingService).toContain('providerExtension?.registered');
    expect(routingService).toContain('company.forwardingEnabled');
  });
});
