import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildOnlinePbxRoutingPlan,
  buildOnlinePbxRoutingTargets,
  ONLINE_PBX_FALLBACK_RING_GROUP,
  ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS,
  ONLINE_PBX_RING_GROUP,
  ONLINE_PBX_TRUNK_NUMBER,
  onlinePbxRoutingDestination,
} from '../shared/telephony';

const repositoryRoot = path.resolve(import.meta.dirname, '..');

describe('OnlinePBX manager routing settings', () => {
  it('rings the preferred online manager first and excludes offline or disabled managers', () => {
    expect(ONLINE_PBX_RING_GROUP).toBe('10');
    expect(ONLINE_PBX_FALLBACK_RING_GROUP).toBe('11');
    expect(ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS).toBe(3);
    expect(ONLINE_PBX_TRUNK_NUMBER).toBe('998787070171');
    expect(onlinePbxRoutingDestination('90 123-45-67')).toBe('998901234567');
    expect(onlinePbxRoutingDestination(`+${ONLINE_PBX_TRUNK_NUMBER}`)).toBeNull();

    const plan = buildOnlinePbxRoutingPlan([
      { id: 7, phone: '+998901234567', enabled: true, isOnline: true },
      { id: 13, phone: '+998911234567', enabled: true, isOnline: true },
      { id: 15, phone: '+998931234567', enabled: true, isOnline: false },
      { id: 18, phone: '+998941234567', enabled: false, isOnline: true },
    ], 13);

    expect(plan.primary).toMatchObject({ id: 13, destination: '998911234567' });
    expect(plan.fallback).toEqual([
      expect.objectContaining({ id: 7, destination: '998901234567' }),
    ]);
    expect(buildOnlinePbxRoutingTargets(plan)).toEqual({
      primaryUsers: ['998911234567'],
      primaryDelay: 3,
      primaryDefaultDestination: '11',
      fallbackUsers: ['998901234567'],
      fallbackDelay: 20,
    });
  });

  it('falls back to the next online manager and never duplicates a shared phone', () => {
    const plan = buildOnlinePbxRoutingPlan([
      { id: 7, phone: '+998901234567', enabled: true, isOnline: true },
      { id: 13, phone: '+998901234567', enabled: true, isOnline: true },
      { id: 15, phone: '+998931234567', enabled: true, isOnline: false },
    ], 15);

    expect(plan.primary?.id).toBe(7);
    expect(plan.fallback).toEqual([]);
    expect(buildOnlinePbxRoutingTargets(plan)).toMatchObject({
      primaryUsers: ['998901234567'],
      primaryDelay: 20,
      primaryDefaultDestination: null,
    });
    expect(buildOnlinePbxRoutingTargets({ primary: null, fallback: [] })).toMatchObject({
      primaryUsers: ['0'],
      primaryDelay: 1,
      primaryDefaultDestination: null,
      fallbackUsers: ['0'],
    });
  });

  it('keeps manager routing controls in the OnlinePBX settings dialog', () => {
    const integrationsPage = fs.readFileSync(
      path.join(repositoryRoot, 'client/src/pages/academy.tsx'),
      'utf8',
    );
    const phoneWidget = fs.readFileSync(
      path.join(repositoryRoot, 'client/src/components/telephony/TelephonyWidget.tsx'),
      'utf8',
    );

    expect(integrationsPage).toContain("queryKey: ['/api/telephony/routing']");
    expect(integrationsPage).toContain('onlinePbxSettingsOpen');
    expect(integrationsPage).toContain("t('onlinePbxTestConnection')");
    expect(integrationsPage).toContain("t('onlinePbxReceiveCalls')");
    expect(integrationsPage).toContain("t('onlinePbxMakePrimary')");
    expect(integrationsPage).toContain('updateOnlinePbxRouting.mutate(onlinePbxRoutingDraft)');
    expect(phoneWidget).not.toContain('/api/telephony/routing');
  });

  it('protects routing settings, audits changes, and filters the provider groups by presence', () => {
    const route = fs.readFileSync(
      path.join(repositoryRoot, 'server/routes/telephony.routes.ts'),
      'utf8',
    );
    const routingService = fs.readFileSync(
      path.join(repositoryRoot, 'server/services/telephony-routing.ts'),
      'utf8',
    );

    expect(route).toContain("router.get('/routing', requireAuth");
    expect(route).toContain("router.put('/routing', requireAuth");
    expect(route).toContain('hasLeadershipAccess(req.user)');
    expect(route).toContain('UPDATE_TELEPHONY_ROUTING');
    expect(route).toContain("res.status(410).json({ error: 'onlinePbxForwardingReplaced' })");
    expect(routingService).toContain('manager.is_online');
    expect(routingService).toContain('ONLINE_PBX_PRIMARY_RING_DELAY_SECONDS');
    expect(routingService).toContain('ONLINE_PBX_FALLBACK_RING_GROUP');
  });
});
