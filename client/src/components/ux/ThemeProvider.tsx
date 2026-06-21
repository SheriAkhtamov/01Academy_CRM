import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = Exclude<Theme, 'system'>;

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);
const supportedThemes = new Set<Theme>(['light', 'dark', 'system']);

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredTheme(storageKey: string, defaultTheme: Theme): Theme {
  if (typeof window === 'undefined') return defaultTheme;

  try {
    const storedTheme = window.localStorage.getItem(storageKey) as Theme | null;
    return storedTheme && supportedThemes.has(storedTheme) ? storedTheme : defaultTheme;
  } catch {
    return defaultTheme;
  }
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'academy-crm-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(storageKey, defaultTheme));
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => (
    typeof window === 'undefined' ? 'light' : resolveTheme(readStoredTheme(storageKey, defaultTheme))
  ));

  useLayoutEffect(() => {
    const root = window.document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (nextResolvedTheme: ResolvedTheme) => {
      root.classList.remove('light', 'dark');
      root.classList.add(nextResolvedTheme);
      root.style.colorScheme = nextResolvedTheme;
      setResolvedTheme(nextResolvedTheme);
    };

    applyTheme(theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);

    if (theme !== 'system') return undefined;

    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      applyTheme(event.matches ? 'dark' : 'light');
    };

    media.addEventListener('change', handleSystemThemeChange);
    return () => media.removeEventListener('change', handleSystemThemeChange);
  }, [theme]);

  const setTheme = useCallback((newTheme: Theme) => {
    try {
      window.localStorage.setItem(storageKey, newTheme);
    } catch {
      // The UI should still switch when storage is unavailable.
    }
    setThemeState(newTheme);
  }, [storageKey]);

  const value = useMemo(
    () => ({ theme, setTheme, resolvedTheme }),
    [resolvedTheme, setTheme, theme],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
