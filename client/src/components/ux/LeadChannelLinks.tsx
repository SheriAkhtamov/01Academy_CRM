import { Instagram } from 'lucide-react';
import type { LeadChannelView } from '@shared/lead-channels';
import {
  buildLeadChannelProfileUrl,
  dedupeLeadChannelsForDisplay,
  safeLeadChannelProfileUrl,
} from '@shared/lead-channels';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const channelStyle = 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100';

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
  const uniqueChannels = dedupeLeadChannelsForDisplay(channels)
    .filter((channel) => channel.channel === 'instagram');

  if (uniqueChannels.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {uniqueChannels.map((channel) => {
        const Icon = Instagram;
        const generatedUrl = buildLeadChannelProfileUrl(channel.channel, channel.handle, channel.externalId);
        const href = safeLeadChannelProfileUrl(channel.channel, channel.profileUrl)
          ?? safeLeadChannelProfileUrl(channel.channel, generatedUrl)
          ?? (channel.channel === 'instagram' && leadId ? `/sales/messages?lead=${leadId}` : null);
        const external = Boolean(href?.startsWith('https://'));
        const label = channelLabel(channel);
        const buttonClassName = cn(showLabels ? 'h-9 gap-2' : 'size-9', channelStyle);
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
