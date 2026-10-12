import React from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function Logo({ size = 'md', className = '' }: LogoProps) {
  const { t } = useTranslation();
  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-20 h-20'
  };

  return (
    <div className={`${sizeClasses[size]} ${className} flex items-center justify-center`}>
      <img
        src="/logo.png"
        alt={t('platformName')}
        className="h-full w-full object-contain transition-[filter] duration-200 dark:brightness-0 dark:invert"
      />
    </div>
  );
}
