import { useState, useEffect, useCallback } from 'react';
import { i18n, type Language, type TranslationKey } from '@/lib/i18n';

export function useTranslation() {
  const [currentLanguage, setCurrentLanguage] = useState<Language>(i18n.getCurrentLanguage());

  useEffect(() => {
    const unsubscribe = i18n.subscribe((lang: Language) => {
      setCurrentLanguage(lang);
    });

    return unsubscribe;
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return i18n.t(key);
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
