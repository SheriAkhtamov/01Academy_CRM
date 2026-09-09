// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultKpiConfig, type KpiPlanSettings } from '../shared/sales-kpi';
import { translations, type TranslationKey } from '../client/src/lib/i18n';
const hooks = vi.hoisted(() => ({ plans: vi.fn(), save: vi.fn(), company: vi.fn(), saveCompany: vi.fn() }));
vi.mock('../client/src/features/sales-kpi/hooks', () => ({
  useKpiPlans: hooks.plans,
  useSaveKpiRules: () => ({ mutateAsync: hooks.save, isPending: false, isError: false }),
  useCompanyTargets: hooks.company,
  useSaveCompanyTargets: () => ({ mutateAsync: hooks.saveCompany, isPending: false, isError: false }),
}));
vi.mock('../client/src/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: TranslationKey) => translations[key].en, language: 'en' }),
}));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { KpiSettingsPanel } from '../client/src/features/sales-kpi/ui/KpiSettingsPanel';
import { DEFAULT_COMPANY_SETTINGS } from '../client/src/components/ux/academy/KpiSettingsCard';

const settings = (): KpiPlanSettings => ({ currentMonth: '2026-09', minimumEffectiveMonth: { hunter: '2026-10', closer: '2026-10' },
  versions: [{ id: 2, role: 'hunter', config: defaultKpiConfig('hunter'), effectiveMonth: '2026-09', createdAt: '2026-09-01T00:00:00Z', createdBy: 1 }] });

describe('sales KPI settings dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.plans.mockReturnValue({ data: settings(), isPending: false, isError: false });
    hooks.save.mockResolvedValue({});
    hooks.company.mockReturnValue({ data: { ...DEFAULT_COMPANY_SETTINGS, targetRevenueMonthlyUzs: 50000000, targetNewLeadsMonthly: 400 }, isPending: false, isError: false });
    hooks.saveCompany.mockResolvedValue({});
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps rule editing in a modal and does not silently adopt a concurrent version', async () => {
    const user = userEvent.setup();
    const view = render(<KpiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: translations.kpiEditPlan.en }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    const updated = settings();
    updated.versions.unshift({ ...updated.versions[0], id: 3, effectiveMonth: '2026-10' });
    hooks.plans.mockReturnValue({ data: updated, isPending: false, isError: false });
    view.rerender(<KpiSettingsPanel />);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: translations.save.en }));
    expect(hooks.save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersionId: 2, effectiveMonth: '2026-10' }));
  });
  it('requires explicit confirmation before removing a bonus tier', async () => {
    const user = userEvent.setup();
    render(<KpiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: translations.kpiEditPlan.en }));
    await user.click(screen.getByRole('tab', { name: translations.kpiPaySettings.en }));
    const removeButtons = screen.getAllByRole('button', { name: translations.kpiRemoveTier.en });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[1]);
    const confirmation = screen.getByRole('alertdialog');
    expect(screen.getAllByLabelText(translations.kpiTierFrom.en)).toHaveLength(2);
    await user.click(within(confirmation).getByRole('button', { name: translations.delete.en }));
    expect(screen.getAllByLabelText(translations.kpiTierFrom.en)).toHaveLength(1);
    expect(hooks.save).not.toHaveBeenCalled();
  });
  it('rejects invalid salary values without losing the open draft', async () => {
    const user = userEvent.setup();
    render(<KpiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: translations.kpiEditPlan.en }));
    await user.click(screen.getByRole('tab', { name: translations.kpiPaySettings.en }));
    const dialog = screen.getByRole('dialog');
    const amount = within(dialog).getByLabelText(translations.kpiBaseSalary.en);
    await user.clear(amount);
    await user.type(amount, '-1');
    await user.click(screen.getByRole('tab', { name: translations.kpiPlanTargets.en }));
    await user.click(within(dialog).getByRole('button', { name: translations.save.en }));
    expect(hooks.save).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('tab', { name: new RegExp(translations.kpiPaySettings.en) }).getAttribute('aria-selected')).toBe('true'));
    expect((screen.getByLabelText(translations.kpiBaseSalary.en) as HTMLInputElement).value).toBe('-1');
  });

  it('shows company goals and both employee plans without an inline editor or technical copy', () => {
    const data = settings();
    data.versions.push({ ...data.versions[0], id: 3, role: 'closer', config: defaultKpiConfig('closer') });
    hooks.plans.mockReturnValue({ data, isPending: false, isError: false });
    render(<KpiSettingsPanel />);
    expect(screen.getByRole('region', { name: translations.kpiCompanyGoals.en })).toBeTruthy();
    expect(within(screen.getByRole('article', { name: translations.kpiHunter.en })).getByText('30')).toBeTruthy();
    expect(within(screen.getByRole('article', { name: translations.kpiCloser.en })).getByText('21')).toBeTruthy();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/version|tracking|retroactive|timezone|API|database/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /calculate salary|calculator/i })).toBeNull();
  });

  it('preserves edits across tabs and saves only after the explicit save action', async () => {
    const user = userEvent.setup();
    render(<KpiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: translations.kpiEditPlan.en }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /calculate salary|calculator/i })).toBeNull();
    const volume = screen.getByLabelText(translations.kpiMonthlyBookings.en);
    fireEvent.change(volume, { target: { value: '45' } });
    await user.click(screen.getByRole('tab', { name: translations.kpiPaySettings.en }));
    fireEvent.change(screen.getByLabelText(translations.kpiBaseSalary.en), { target: { value: '4000000' } });
    await user.click(screen.getByRole('tab', { name: translations.kpiServiceStandards.en }));
    await user.click(screen.getByRole('tab', { name: translations.kpiPlanTargets.en }));
    expect((screen.getByLabelText(translations.kpiMonthlyBookings.en) as HTMLInputElement).value).toBe('45');
    expect(hooks.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: translations.save.en }));
    await waitFor(() => expect(hooks.save).toHaveBeenCalledWith({ role: 'hunter', effectiveMonth: '2026-10', expectedVersionId: 2,
      config: { ...defaultKpiConfig('hunter'), volumeTarget: 45, baseSalaryUzs: 4000000 } }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('protects the draft when cancelling a plan and can return to editing', async () => {
    const user = userEvent.setup();
    render(<KpiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: translations.kpiEditPlan.en }));
    fireEvent.change(screen.getByLabelText(translations.kpiMonthlyBookings.en), { target: { value: '45' } });
    await user.click(screen.getByRole('button', { name: translations.cancel.en }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: translations.keepEditing.en }));
    expect((screen.getByLabelText(translations.kpiMonthlyBookings.en) as HTMLInputElement).value).toBe('45');
    expect(hooks.save).not.toHaveBeenCalled();
  });

  it('edits company goals in a modal and preserves the other targets and phone access', async () => {
    const user = userEvent.setup();
    render(<KpiSettingsPanel />);
    await user.click(screen.getByRole('button', { name: translations.kpiEditCompanyGoals.en }));
    const dialog = screen.getByRole('dialog', { name: translations.kpiCompanyGoals.en });
    expect(within(dialog).getByRole('group', { name: translations.kpiMarketingTargets.en })).toBeTruthy();
    expect(within(dialog).getByLabelText(translations.kpiCacLabel.en)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(translations.targetMonthlyRevenue.en), { target: { value: '60000000' } });
    await user.click(within(dialog).getByRole('button', { name: translations.saveGoals.en }));
    await waitFor(() => expect(hooks.saveCompany).toHaveBeenCalledWith({ ...DEFAULT_COMPANY_SETTINGS, targetRevenueMonthlyUzs: 60000000, targetNewLeadsMonthly: 400 }));
    expect(hooks.save).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the active plan visible when another plan is scheduled and opens its details by date', async () => {
    const user = userEvent.setup();
    const data = settings();
    data.versions.unshift({ ...data.versions[0], id: 10, effectiveMonth: '2026-10', config: { ...defaultKpiConfig('hunter'), volumeTarget: 50 } });
    hooks.plans.mockReturnValue({ data, isPending: false, isError: false });
    render(<KpiSettingsPanel />);
    expect(within(screen.getByRole('article', { name: translations.kpiHunter.en })).getByText('30')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Changes from October 2026' }));
    const dialog = screen.getByRole('dialog', { name: `${translations.kpiHistory.en} · ${translations.kpiHunter.en}` });
    expect(within(dialog).getAllByText('50').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/\bversion\b/i)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: translations.save.en })).toBeNull();
  });
});
