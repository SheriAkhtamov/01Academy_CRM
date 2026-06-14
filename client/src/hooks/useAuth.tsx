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

interface AuthContextType {
  session: AuthSession;
  user: SanitizedUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (login: string, password: string) => Promise<AuthSession>;
  logout: () => Promise<void>;
  setUser: (user: SanitizedUser | null) => void;
  refetchSession: () => Promise<AuthSession>;
}

const anonymousSession: AuthSession = { kind: 'anonymous' };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery<AuthSession>({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: fetchAuthSession,
    retry: false,
    staleTime: 0,
  });

  const syncSession = async () => (
    queryClient.fetchQuery({
      queryKey: AUTH_SESSION_QUERY_KEY,
      queryFn: fetchAuthSession,
      staleTime: 0,
    })
  );

  const loginMutation = useMutation({
    mutationFn: async ({ login, password }: { login: string; password: string }) => {
      await loginUserSession(login, password);
      return syncSession();
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await logoutSession();
    },
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, anonymousSession);
    },
  });

  const login = async (loginValue: string, password: string) => (
    loginMutation.mutateAsync({ login: loginValue, password })
  );

  const logout = async () => {
    await logoutMutation.mutateAsync();
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
        isLoading:
          sessionQuery.isLoading ||
          loginMutation.isPending ||
          logoutMutation.isPending,
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
