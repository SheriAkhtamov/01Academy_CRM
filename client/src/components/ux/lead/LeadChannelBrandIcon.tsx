import { siFacebook, siInstagram, siTelegram, siWhatsapp } from 'simple-icons';
import type { LeadChannelKind } from '@shared/lead-channels';
import { cn } from '@/lib/utils';

const icons = {
  instagram: siInstagram,
  telegram: siTelegram,
  facebook: siFacebook,
  whatsapp: siWhatsapp,
} as const;

export function LeadChannelBrandIcon({ channel, className }: {
  channel: LeadChannelKind;
  className?: string;
}) {
  const icon = icons[channel];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn('size-5 shrink-0', className)}
      style={{ color: `#${icon.hex}` }}
      aria-hidden="true"
    >
      <path d={icon.path} />
    </svg>
  );
}
