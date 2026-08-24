// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadSocialAccountsEditor } from '../client/src/components/ux/lead/LeadSocialAccountsEditor';
import { TooltipProvider } from '../client/src/components/ui/tooltip';
import type { LeadChannelView } from '../shared/lead-channels';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
(Element.prototype as unknown as Record<string, unknown>).hasPointerCapture = () => false;
(Element.prototype as unknown as Record<string, unknown>).setPointerCapture = () => undefined;
(Element.prototype as unknown as Record<string, unknown>).releasePointerCapture = () => undefined;
(Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => undefined;

const apiMocks = vi.hoisted(() => ({
  addSocialAccount: vi.fn(),
  updateSocialAccount: vi.fn(),
  removeSocialAccount: vi.fn(),
}));

vi.mock('../client/src/features/leads/api', () => ({
  leadsApi: apiMocks,
}));

const renderEditor = (props: {
  managerId?: number | null;
  channels?: LeadChannelView[];
  canClaimUnassignedLead?: boolean;
} = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TooltipProvider>
      <LeadSocialAccountsEditor
        leadId={42}
        leadName="Александра"
        managerId={props.managerId === undefined ? 7 : props.managerId}
        channels={props.channels ?? []}
        canClaimUnassignedLead={props.canClaimUnassignedLead}
        onChanged={vi.fn()}
      />
    </TooltipProvider>
  </QueryClientProvider>,
);

const openCreateForm = async (networkName: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name: /Добавить аккаунт|Add account/i }));
  fireEvent.click(await screen.findByRole('option', { name: networkName }));
};

describe('lead social account editor', () => {
  beforeEach(() => {
    apiMocks.addSocialAccount.mockReset();
    apiMocks.updateSocialAccount.mockReset();
    apiMocks.removeSocialAccount.mockReset();
    apiMocks.addSocialAccount.mockResolvedValue({ channels: [] });
    apiMocks.updateSocialAccount.mockResolvedValue({ channels: [] });
    apiMocks.removeSocialAccount.mockResolvedValue({ channels: [] });
  });

  it('opens the network dropdown first and saves one link-or-username field', async () => {
    renderEditor();
    await openCreateForm(/Телеграм|Telegram/i);

    const input = screen.getByLabelText(/Ссылка на профиль или username|Profile link or username/i);
    fireEvent.change(input, { target: { value: '@academy_support' } });
    fireEvent.click(screen.getByRole('button', { name: /^Сохранить$|^Save$/i }));

    await waitFor(() => expect(apiMocks.addSocialAccount).toHaveBeenCalledWith(42, {
      channel: 'telegram',
      value: '@academy_support',
      assignToSelf: undefined,
    }));
  });

  it('detects a duplicate before sending it to the server', async () => {
    renderEditor({
      channels: [{
        id: 8,
        channel: 'instagram',
        handle: 'academy.uz',
        profileUrl: 'https://www.instagram.com/academy.uz/',
        isManual: true,
      }],
    });
    await openCreateForm(/Инстаграм|Instagram/i);

    fireEvent.change(screen.getByLabelText(/Ссылка на профиль или username|Profile link or username/i), {
      target: { value: '@academy.uz' },
    });
    fireEvent.blur(screen.getByLabelText(/Ссылка на профиль или username|Profile link or username/i));

    expect(await screen.findByText(/уже добавлен|already linked/i)).toBeTruthy();
    expect(apiMocks.addSocialAccount).not.toHaveBeenCalled();
  });

  it('detects a WhatsApp number that already came from an integration', async () => {
    renderEditor({
      channels: [{
        id: 18,
        channel: 'whatsapp',
        externalId: '+998 (90) 123-45-67',
        providerAccountId: 'whatsapp-cloud',
        isManual: false,
      }],
    });
    await openCreateForm(/Ватсап|WhatsApp/i);

    fireEvent.change(screen.getByLabelText(/Ссылка на профиль или username|Profile link or username/i), {
      target: { value: '+998 90 123 45 67' },
    });
    fireEvent.blur(screen.getByLabelText(/Ссылка на профиль или username|Profile link or username/i));

    expect(await screen.findByText(/уже добавлен|already linked/i)).toBeTruthy();
    expect(apiMocks.addSocialAccount).not.toHaveBeenCalled();
  });

  it('asks to assign an unassigned lead and then continues automatically', async () => {
    renderEditor({ managerId: null, canClaimUnassignedLead: true });
    await openCreateForm(/Инстаграм|Instagram/i);
    fireEvent.change(screen.getByLabelText(/Ссылка на профиль или username|Profile link or username/i), {
      target: { value: '@academy.uz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Сохранить$|^Save$/i }));

    expect(apiMocks.addSocialAccount).not.toHaveBeenCalled();
    const assignmentDialog = await screen.findByRole('dialog', {
      name: /Присвойте лид|Assign the lead/i,
    });
    fireEvent.click(within(assignmentDialog).getByRole('button', {
      name: /Присвоить себе и продолжить|Assign to me and continue/i,
    }));

    await waitFor(() => expect(apiMocks.addSocialAccount).toHaveBeenCalledWith(42, {
      channel: 'instagram',
      value: '@academy.uz',
      assignToSelf: true,
    }));
  });

  it('deletes a manual account only after destructive confirmation', async () => {
    renderEditor({
      channels: [{
        id: 9,
        channel: 'whatsapp',
        handle: '998901234567',
        profileUrl: 'https://wa.me/998901234567',
        isManual: true,
      }],
    });

    fireEvent.click(screen.getByRole('button', { name: /Удалить аккаунт соцсети|Delete social account/i }));
    const confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: /^Удалить$|^Delete$/i }));

    await waitFor(() => expect(apiMocks.removeSocialAccount).toHaveBeenCalledWith(42, 9, {
      assignToSelf: undefined,
    }));
  });
});
