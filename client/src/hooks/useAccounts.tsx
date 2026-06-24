import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SAVED_ACCOUNTS_QUERY_KEY,
  type SavedAccountEntry,
} from '@shared/auth';
import {
  fetchSavedAccounts,
  addSavedAccount,
  switchAccount,
  removeSavedAccount,
} from '@/lib/session';

const STORAGE_KEY_TOKENS = 'academy-saved-account-tokens';
const linkTokenKey = (savedAccountId: number) => `link:${savedAccountId}`;
const userTokenKey = (userId: number) => `user:${userId}`;

function loadTokenMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TOKENS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTokenMap(map: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(map));
}

function addToken(accountId: number, savedAccountId: number, token: string): void {
  const map = loadTokenMap();
  map[linkTokenKey(savedAccountId)] = token;
  map[userTokenKey(accountId)] = token;
  saveTokenMap(map);
}

function removeToken(account: SavedAccountEntry): void {
  const map = loadTokenMap();
  delete map[linkTokenKey(account.id)];
  delete map[userTokenKey(account.accountUser.id)];
  delete map[account.accountUser.id];
  saveTokenMap(map);
}

function getTokenCandidates(account: SavedAccountEntry): string[] {
  const map = loadTokenMap();
  const preferredTokens = [
    map[linkTokenKey(account.id)],
    map[userTokenKey(account.accountUser.id)],
    // Supports saved links created before link-specific keys were introduced.
    map[account.accountUser.id],
  ];

  return Array.from(new Set([
    ...preferredTokens,
    ...Object.values(map),
  ].filter((token): token is string => Boolean(token))));
}

interface UseAccountsReturn {
  accounts: SavedAccountEntry[];
  isLoading: boolean;
  addAccount: (login: string, password: string) => Promise<void>;
  switchToAccount: (account: SavedAccountEntry) => Promise<void>;
  removeAccount: (account: SavedAccountEntry) => Promise<void>;
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
    mutationFn: async ({ login, password }: { login: string; password: string }) => {
      const result = await addSavedAccount(login, password);
      addToken(result.id, result.savedAccountId, result.token);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SAVED_ACCOUNTS_QUERY_KEY });
    },
  });

  const switchMutation = useMutation({
    mutationFn: async (account: SavedAccountEntry) => {
      const tokenCandidates = getTokenCandidates(account);
      if (tokenCandidates.length === 0) {
        throw new Error('No token found for this account. Please re-add the account.');
      }
      const result = await switchAccount(tokenCandidates, account.accountUser.id);
      const matchedToken = tokenCandidates[result.matchedTokenIndex];
      if (matchedToken) {
        addToken(account.accountUser.id, account.id, matchedToken);
      }
      return result;
    },
    onSuccess: () => {
      // The next account has a different permission boundary. Clear all
      // account-scoped cache before the UI navigates to its workspace home.
      queryClient.clear();
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (account: SavedAccountEntry) => {
      return removeSavedAccount(account.id);
    },
    onSuccess: (_result, account) => {
      removeToken(account);
      queryClient.invalidateQueries({ queryKey: SAVED_ACCOUNTS_QUERY_KEY });
    },
  });

  const addAccount = useCallback(
    async (login: string, password: string) => {
      await addMutation.mutateAsync({ login, password });
    },
    [addMutation],
  );

  const switchToAccount = useCallback(
    async (account: SavedAccountEntry) => {
      await switchMutation.mutateAsync(account);
    },
    [switchMutation],
  );

  const removeAccount = useCallback(
    async (account: SavedAccountEntry) => {
      await removeMutation.mutateAsync(account);
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
