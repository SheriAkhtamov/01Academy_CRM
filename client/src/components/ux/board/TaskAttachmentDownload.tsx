import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { downloadBoardAttachment } from '@/features/board/transport';

export function TaskAttachmentDownload({ id, name, compact = false }: { id: number; name: string; compact?: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const label = `${t('download')}: ${name}`;
  const content = compact ? <Download className="size-4" /> : t('download');
  return <Button size={compact ? 'icon' : 'default'} variant="outline" disabled={pending} aria-label={label} onClick={async () => {
    setPending(true);
    try { await downloadBoardAttachment(id, name); }
    catch { toast({ title: t('attachmentDownloadFailed'), variant: 'destructive' }); }
    finally { setPending(false); }
  }}>{pending ? <Loader2 className="size-4 animate-spin" /> : content}</Button>;
}
