import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SAVED_ACCOUNTS_QUERY_KEY,
  AUTH_SESSION_QUERY_KEY,
  type SavedAccountEntry,
  type AuthSession,
} from '@shared/auth';
import {
  fetchSavedAccounts,
  addSavedAccount,
  switchAccount,
  removeSavedAccount,
} from '@/lib/session';

const STORAGE_KEY_TOKENS = 'academy-saved-account-tokens';

function loadTokenMap(): Record<number, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TOKENS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTokenMap(map: Record<number, string>): void {
  localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(map));
}

function addToken(accountId: number, token: string): void {
  const map = loadTokenMap();
  map[accountId] = token;
  saveTokenMap(map);
}

function removeToken(accountId: number): void {
  const map = loadTokenMap();
  delete map[accountId];
  saveTokenMap(map);
}

function getTokenForAccount(accountId: number): string | null {
  return loadTokenMap()[accountId] || null;
}

interface UseAccountsReturn {
  accounts: SavedAccountEntry[];
  isLoading: boolean;
  addAccount: (login: string, password: string, label?: string) => Promise<void>;
  switchToAccount: (accountId: number) => Promise<void>;
  removeAccount: (accountId: number) => Promise<void>;
  isAdding: boolean;
  isSwitching: boolean;
  isRemoving: boolean;
}

export function useAccounts(): UseAccountsReturn {
  const queryClient = useQueryClient();

  const { data: accounts = [], isLoading } = useQuery<SavedAccountEntry[]>({
    queryKey: SAVED_ACCOUNTS_QUERY_KEY,
    queryFn: fetchSavedAccounts,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async ({ login, password, label }: { login: string; password: string; label?: string }) => {
      const result = await addSavedAccount(login, password, label);
      addToken(result.id, result.token);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SAVED_ACCOUNTS_QUERY_KEY });
    },
  });

  const switchMutation = useMutation({
    mutationFn: async (accountId: number) => {
      const token = getTokenForAccount(accountId);
      if (!token) {
        throw new Error('No token found for this account. Please re-add the account.');
      }
      return switchAccount(token);
    },
    onSuccess: () => {
      queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, (current) => current);
      queryClient.invalidateQueries();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (accountId: number) => {
      removeToken(accountId);
      return removeSavedAccount(accountId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SAVED_ACCOUNTS_QUERY_KEY });
    },
  });

  const addAccount = useCallback(
    async (login: string, password: string, label?: string) => {
      await addMutation.mutateAsync({ login, password, label });
    },
    [addMutation],
  );

  const switchToAccount = useCallback(
    async (accountId: number) => {
      await switchMutation.mutateAsync(accountId);
    },
    [switchMutation],
  );

  const removeAccount = useCallback(
    async (accountId: number) => {
      await removeMutation.mutateAsync(accountId);
    },
    [removeMutation],
  );

  return useMemo(
    () => ({
      accounts,
      isLoading,
      addAccount,
      switchToAccount,
      removeAccount,
      isAdding: addMutation.isPending,
      isSwitching: switchMutation.isPending,
      isRemoving: removeMutation.isPending,
    }),
    [accounts, isLoading, addAccount, switchToAccount, removeAccount, addMutation.isPending, switchMutation.isPending, removeMutation.isPending],
  );
}
