import { describe, expect, it } from 'vitest';
import {
  funnelForSource,
  leadsForFunnel,
  leadToPaidConversion,
  marketingFunnelMetrics,
  marketingFunnelStages,
} from '../client/src/lib/marketingLogic';

const stages = [
  { code: 'new_request', sortOrder: 0 },
  { code: 'demo_invited', sortOrder: 40 },
  { code: 'demo_attended', sortOrder: 50 },
  { code: 'paid', sortOrder: 90 },
  { code: 'custom_hunter', sortOrder: 20, funnelId: 1 },
  { code: 'other_custom_hunter', sortOrder: 20, funnelId: 2 },
  { code: 'inactive', sortOrder: 30, funnelId: 1, isActive: false },
  { code: 'closed', sortOrder: 100, funnelId: 1, isPipeline: false },
];

describe('marketing funnel selection', () => {
  it('uses the selected funnel workflow and its own custom stages', () => {
    expect(marketingFunnelStages(stages, { id: 1, workflowRole: 'hunter' }).map((stage) => stage.code))
      .toEqual(['new_request', 'custom_hunter', 'demo_invited']);
    expect(marketingFunnelStages(stages, { id: 2, workflowRole: 'hunter' }).map((stage) => stage.code))
      .toEqual(['new_request', 'other_custom_hunter', 'demo_invited']);
    expect(marketingFunnelStages(stages, { id: 3, workflowRole: 'closer' }).map((stage) => stage.code))
      .toEqual(['demo_attended', 'paid']);
    expect(marketingFunnelStages(stages)).toEqual([]);
  });

  it('keeps funnel and source counts isolated even when funnels share system stages', () => {
    const funnel = [{ code: 'new_request', count: 10 }, { code: 'paid', count: 5 }];
    const leads = [
      { sourceId: 1, funnelId: 1, statusCode: 'new_request' },
      { sourceId: 1, funnelId: 1, statusCode: 'paid' },
      { sourceId: 2, funnelId: 1, statusCode: 'paid' },
      { sourceId: 1, funnelId: 2, statusCode: 'paid' },
    ];
    expect(funnelForSource(funnel, leadsForFunnel(leads, '1', '1'), 'all').map((stage) => stage.count)).toEqual([2, 1]);
    expect(funnelForSource(funnel, leadsForFunnel(leads, '1', 'all'), 'all').map((stage) => stage.count)).toEqual([3, 2]);
    expect(funnelForSource(funnel, leadsForFunnel(leads, '2', '1'), 'all').map((stage) => stage.count)).toEqual([1, 1]);
    expect(funnelForSource(funnel, [], 'all').map((stage) => stage.count)).toEqual([0, 0]);
  });

  it('recalculates conversions and deal cycle from the same selected cohort and real payments', () => {
    const leads = [
      { funnelId: 1, sourceId: 1, statusCode: 'custom_hunter', hasPaidPayment: true, demoAttended: true, createdAt: '2026-10-01T00:00:00Z', firstPaidAt: '2026-10-03T00:00:00Z' },
      { funnelId: 1, sourceId: 1, statusCode: 'paid', hasPaidPayment: false },
      { funnelId: 2, sourceId: 1, statusCode: 'new_request', hasPaidPayment: false },
    ];
    expect(marketingFunnelMetrics(leadsForFunnel(leads, '1', '1'))).toEqual({
      leadToDemoConversion: 100,
      demoToPaidConversion: 50,
      leadToPaidConversion: 50,
      avgDealCycleDays: 2,
    });
    expect(marketingFunnelMetrics(leadsForFunnel(leads, '2', '1')).leadToPaidConversion).toBe(0);
    expect(marketingFunnelMetrics([]).avgDealCycleDays).toBeNull();
    expect(leadToPaidConversion(leadsForFunnel(leads, '1', '1'))).toBe(50);
  });
});
