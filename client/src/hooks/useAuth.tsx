import { createContext, useContext, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSessionUser,
  isAnonymousSession,
  isUserSession,
  AUTH_SESSION_QUERY_KEY,
  type AuthSession,
  type SanitizedUser,
} from '@shared/auth';
import {
  fetchAuthSession,
  loginUserSession,
  logoutSession,
} from '@/lib/session';
import { toast } from '@/hooks/use-toast';
import { i18n } from '@/lib/i18n';
import { endAuthenticatedSession } from '@/lib/queryClient';

interface AuthContextType {
  session: AuthSession;
  user: SanitizedUser | null;
  isLoading: boolean;
  isSessionError: boolean;
  isRefetchingSession: boolean;
  isAuthenticated: boolean;
  login: (login: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
  setUser: (user: SanitizedUser | null) => void;
  refetchSession: () => Promise<AuthSession>;
}

const anonymousSession: AuthSession = { kind: 'anonymous' };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const defaultAuthApi = { fetchAuthSession, loginUserSession, logoutSession };
export function AuthProvider({ children, api = defaultAuthApi }: { children: ReactNode; api?: typeof defaultAuthApi }) {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery<AuthSession>({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: api.fetchAuthSession,
    retry: false,
    staleTime: 0,
  });

  const syncSession = async () => (
    queryClient.fetchQuery({
      queryKey: AUTH_SESSION_QUERY_KEY,
      queryFn: api.fetchAuthSession,
      staleTime: 0,
    })
  );

  const loginMutation = useMutation({
    mutationFn: async ({ login, password }: { login: string; password: string }) => {
      await api.loginUserSession(login, password);
      return syncSession();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await api.logoutSession();
    },
    onSuccess: () => {
      endAuthenticatedSession(queryClient);
    },
    // Without this a failed request left the button doing nothing at all: the
    // cache was only cleared on success, so the user stayed signed in with no
    // hint that anything had gone wrong.
    onError: (error: Error) => {
      toast({
        title: i18n.t('logoutFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const login = async (loginValue: string, password: string) => (
    loginMutation.mutateAsync({ login: loginValue, password })
  );

  const logout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Already surfaced by the mutation's onError toast; callers only need to
      // know the flow finished, not to handle it a second time.
    }
  };

  const setUser = (user: SanitizedUser | null) => {
    queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, (current) => {
      if (!current || isAnonymousSession(current)) {
        return current ?? anonymousSession;
      }

      if (isUserSession(current)) {
        return user
          ? { ...current, user }
          : anonymousSession;
      }

      return current;
    });
  };

  const session = sessionQuery.data ?? anonymousSession;
  const user = getSessionUser(session);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        isLoading: sessionQuery.isLoading,
        isSessionError: sessionQuery.isError && !sessionQuery.data,
        isRefetchingSession: sessionQuery.isFetching,
        isAuthenticated: !isAnonymousSession(session),
        login,
        logout,
        setUser,
        refetchSession: syncSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
