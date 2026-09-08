// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultKpiConfig, type KpiPlanSettings } from '../shared/sales-kpi';
import { translations, type TranslationKey } from '../client/src/lib/i18n';
const hooks = vi.hoisted(() => ({ plans: vi.fn(), save: vi.fn() }));
vi.mock('../client/src/features/sales-kpi/hooks', () => ({
  useKpiPlans: hooks.plans,
  useSaveKpiRules: () => ({ mutateAsync: hooks.save, isPending: false, isError: false }),
}));
vi.mock('../client/src/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: TranslationKey) => translations[key].en, language: 'en' }),
}));
vi.mock('../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { KpiSettingsPanel } from '../client/src/features/sales-kpi/ui/KpiSettingsPanel';

const settings = (): KpiPlanSettings => ({ currentMonth: '2026-09', minimumEffectiveMonth: { hunter: '2026-10', closer: '2026-10' },
  versions: [{ id: 2, role: 'hunter', config: defaultKpiConfig('hunter'), effectiveMonth: '2026-09', createdAt: '2026-09-01T00:00:00Z', createdBy: 1 }] });

describe('sales KPI settings dialogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.plans.mockReturnValue({ data: settings(), isPending: false, isError: false });
    hooks.save.mockResolvedValue({});
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
    await user.click(screen.getByRole('button', { name: translations.kpiEditRules.en }));
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
    await user.click(screen.getByRole('button', { name: translations.kpiEditRules.en }));
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
    await user.click(screen.getByRole('button', { name: translations.kpiEditRules.en }));
    const dialog = screen.getByRole('dialog');
    const amount = within(dialog).getByLabelText(translations.kpiBaseSalary.en);
    await user.clear(amount);
    await user.type(amount, '-1');
    await user.click(within(dialog).getByRole('button', { name: translations.save.en }));
    expect(hooks.save).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
