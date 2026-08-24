import { Facebook, Instagram, MessageCircle, Send } from 'lucide-react';
import {
  LEAD_CHANNELS,
  type LeadChannelKind,
  type LeadChannelView,
} from '@shared/lead-channels';
import {
  buildLeadChannelProfileUrl,
  dedupeLeadChannelsForDisplay,
  safeLeadChannelProfileUrl,
} from '@shared/lead-channels';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const channelStyles: Record<LeadChannelKind, string> = {
  instagram: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100',
  telegram: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
  facebook: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100',
  whatsapp: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
};

const channelIcons = {
  instagram: Instagram,
  telegram: Send,
  facebook: Facebook,
  whatsapp: MessageCircle,
} satisfies Record<LeadChannelKind, typeof Instagram>;

const channelTranslationKeys = {
  instagram: 'socialNetworkInstagram',
  telegram: 'socialNetworkTelegram',
  facebook: 'socialNetworkFacebook',
  whatsapp: 'socialNetworkWhatsApp',
} satisfies Record<LeadChannelKind, TranslationKey>;

const channelAccountValue = (channel: LeadChannelView, socialProfileLabel: string) => {
  const handle = channel.handle?.replace(/^@+/, '') ?? '';
  if (!handle) return '';
  if (channel.channel === 'whatsapp') return `+${handle}`;
  if (channel.channel === 'facebook' && handle.startsWith('profile.php?id=')) {
    return socialProfileLabel;
  }
  return `@${handle}`;
};

export function LeadChannelLinks({
  channels,
  leadId,
  showLabels = false,
  className,
}: {
  channels?: LeadChannelView[] | null;
  leadId?: number | null;
  showLabels?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const uniqueChannels = dedupeLeadChannelsForDisplay(channels)
    .filter((channel): channel is LeadChannelView & { channel: LeadChannelKind } => (
      LEAD_CHANNELS.includes(channel.channel as LeadChannelKind)
    ));

  if (uniqueChannels.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {uniqueChannels.map((channel) => {
        const Icon = channelIcons[channel.channel];
        const generatedUrl = buildLeadChannelProfileUrl(channel.channel, channel.handle, channel.externalId);
        const href = safeLeadChannelProfileUrl(channel.channel, channel.profileUrl)
          ?? safeLeadChannelProfileUrl(channel.channel, generatedUrl)
          ?? (channel.channel === 'instagram' && leadId ? `/sales/messages?lead=${leadId}` : null);
        const external = Boolean(href?.startsWith('https://'));
        const accountValue = channelAccountValue(channel, t('socialProfile'));
        const label = accountValue
          ? `${t(channelTranslationKeys[channel.channel])}: ${accountValue}`
          : t(channelTranslationKeys[channel.channel]);
        const buttonClassName = cn(
          showLabels ? 'h-9 gap-2' : 'size-9',
          channelStyles[channel.channel],
        );
        const content = href ? (
          <Button asChild variant="outline" size={showLabels ? 'sm' : 'icon'} className={buttonClassName}>
            <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} aria-label={label}>
              <Icon />
              {showLabels ? <span>{accountValue || label}</span> : null}
            </a>
          </Button>
        ) : (
          <Button type="button" variant="outline" size={showLabels ? 'sm' : 'icon'} className={buttonClassName} disabled aria-label={label}>
            <Icon />
            {showLabels ? <span>{label}</span> : null}
          </Button>
        );

        return (
          <Tooltip key={channel.id}>
            <TooltipTrigger asChild>
              {content}
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
