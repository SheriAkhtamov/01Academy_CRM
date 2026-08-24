import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Check, Languages } from 'lucide-react';

export default function LanguageSwitcher() {
  const { t, currentLanguage, setLanguage } = useTranslation();

  const languages = [
    { code: 'en' as const, name: t('english'), flag: '🇺🇸' },
    { code: 'ru' as const, name: t('russian'), flag: '🇷🇺' },
  ];

  const currentLang = languages.find(lang => lang.code === currentLanguage);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2" aria-label={t('switchLanguage')}>
          <Languages className="h-4 w-4 mr-1" />
          <span className="text-sm">{currentLang?.flag}</span>
          <span className="sr-only">{t('switchLanguage')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {languages.map((lang) => {
          const isActive = currentLanguage === lang.code;
          return (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => setLanguage(lang.code)}
              aria-current={isActive ? 'true' : undefined}
              className={`flex items-center gap-2 ${isActive ? 'bg-slate-100' : ''}`}
            >
              <span>{lang.flag}</span>
              <span className="text-sm">{lang.name}</span>
              {isActive && <Check className="ml-auto h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
