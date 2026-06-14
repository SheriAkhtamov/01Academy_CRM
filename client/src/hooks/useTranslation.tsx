import { useState, useEffect, useCallback } from 'react';
import { i18n, translations, type Language } from '@/lib/i18n';

export function useTranslation() {
  const [currentLanguage, setCurrentLanguage] = useState<Language>(i18n.getCurrentLanguage());

  useEffect(() => {
    const unsubscribe = i18n.subscribe((lang: Language) => {
      setCurrentLanguage(lang);
    });

    return unsubscribe;
  }, []);

  const t = useCallback((key: string): string => {
    if (!(key in translations)) {
      return key;
    }
    return i18n.t(key as keyof typeof translations);
  }, [currentLanguage]);

  const setLanguage = useCallback((lang: Language): void => {
    i18n.setLanguage(lang);
  }, []);

  return {
    t,
    language: currentLanguage,
    currentLanguage,
    setLanguage,
  };
}
