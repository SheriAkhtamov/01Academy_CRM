import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

// No scripts, forms, navigation, remote images or embedded HTML from a document.
// Base64 images avoid persistent object URLs allocated by the DOCX renderer.
const frameHtml = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>html{color-scheme:light}body{margin:0;background:#fff}*{box-sizing:border-box}.docx-wrapper{padding:12px!important;background:#fff!important}.docx-wrapper>section.docx{width:100%!important;min-height:0!important;padding:16px!important;box-shadow:none!important}img{max-width:100%;height:auto}table{max-width:100%}</style>
</head><body></body></html>`;

export function StudentContractDocxPreview({ blob, name, onError }: { blob: Blob; name: string; onError: () => void }) {
  const { t } = useTranslation();
  const [frameDocument, setFrameDocument] = useState<Document | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!frameDocument) return;
    let cancelled = false;
    setReady(false);
    // Links remain readable, but cannot navigate the isolated contract frame.
    const preventNavigation = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.('a')) event.preventDefault();
    };
    frameDocument.addEventListener('click', preventNavigation);
    void (async () => {
      const { renderAsync } = await import('docx-preview');
      if (cancelled) return;
      const content = frameDocument.createElement('main');
      const styles = frameDocument.createElement('div');
      frameDocument.body.replaceChildren(styles, content);
      await renderAsync(blob, content, styles, {
        ignoreWidth: true, ignoreHeight: true, ignoreFonts: true,
        useBase64URL: true, renderAltChunks: false,
      });
      content.querySelectorAll('a[href]').forEach(link => link.removeAttribute('href'));
      if (!cancelled) setReady(true);
    })().catch(() => { if (!cancelled) onError(); });
    return () => {
      cancelled = true;
      frameDocument.removeEventListener('click', preventNavigation);
    };
  }, [blob, frameDocument, onError]);

  return (
    <div className="relative">
      {!ready ? (
        <div role="status" aria-label={t('loading')} className="absolute inset-0 flex items-center justify-center bg-background">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : null}
      <iframe title={name} srcDoc={frameHtml} sandbox="allow-same-origin" referrerPolicy="no-referrer"
        className="h-[60dvh] min-h-80 w-full rounded-lg border bg-white" aria-busy={!ready}
        onLoad={event => {
          const document = event.currentTarget.contentDocument;
          if (document) setFrameDocument(document);
          else onError();
        }} onError={onError} />
    </div>
  );
}
