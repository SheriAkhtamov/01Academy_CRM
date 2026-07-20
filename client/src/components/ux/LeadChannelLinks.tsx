import { Instagram, MessageCircle, MessageSquare, Send } from 'lucide-react';
import type { LeadChannelView } from '@shared/lead-channels';
import {
  buildLeadChannelProfileUrl,
  dedupeLeadChannelsForDisplay,
  safeLeadChannelProfileUrl,
} from '@shared/lead-channels';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const channelIcon = (channel: string) => {
  if (channel === 'instagram') return Instagram;
  if (channel === 'telegram') return Send;
  if (channel === 'whatsapp') return MessageCircle;
  return MessageSquare;
};

const channelStyle = (channel: string) => {
  if (channel === 'instagram') return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100';
  if (channel === 'telegram') return 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100';
  if (channel === 'whatsapp') return 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
  return '';
};

const channelLabel = (channel: LeadChannelView) => {
  const name = channel.channel.charAt(0).toUpperCase() + channel.channel.slice(1);
  return channel.handle ? `${name}: @${channel.handle.replace(/^@+/, '')}` : name;
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
  const uniqueChannels = dedupeLeadChannelsForDisplay(channels);

  if (uniqueChannels.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {uniqueChannels.map((channel) => {
        const Icon = channelIcon(channel.channel);
        const generatedUrl = buildLeadChannelProfileUrl(channel.channel, channel.handle, channel.externalId);
        const href = safeLeadChannelProfileUrl(channel.channel, channel.profileUrl)
          ?? safeLeadChannelProfileUrl(channel.channel, generatedUrl)
          ?? (channel.channel === 'instagram' && leadId ? `/sales/messages?lead=${leadId}` : null);
        const external = Boolean(href?.startsWith('https://'));
        const label = channelLabel(channel);
        const buttonClassName = cn(showLabels ? 'h-9 gap-2' : 'size-9', channelStyle(channel.channel));
        const content = href ? (
          <Button asChild variant="outline" size={showLabels ? 'sm' : 'icon'} className={buttonClassName}>
            <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} aria-label={label}>
              <Icon />
              {showLabels ? <span>{channel.handle ? `@${channel.handle.replace(/^@+/, '')}` : label}</span> : null}
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
