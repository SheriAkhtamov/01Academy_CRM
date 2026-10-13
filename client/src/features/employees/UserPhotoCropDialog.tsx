import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { TranslationKey } from '@/lib/i18n';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';
import {
  clampCropPosition,
  exportCroppedPhoto,
  getCropRect,
  loadCropImage,
  MAX_CROP_ZOOM,
  MIN_CROP_ZOOM,
  type CropPosition,
  type LoadedCropImage,
} from './profile-photo-crop';

const INITIAL_POSITION: CropPosition = { centerX: 0.5, centerY: 0.5, zoom: MIN_CROP_ZOOM };

type Drag = { pointerId: number; clientX: number; clientY: number; position: CropPosition; viewportWidth: number };

export function UserPhotoCropDialog({ file, titleKey = 'cropProfilePhoto', disabled = false, onApply, onCancel, onCloseAutoFocus }: {
  file: File;
  titleKey?: TranslationKey;
  disabled?: boolean;
  onApply: (photo: File) => void;
  onCancel: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  const zoomId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const lifecycle = useRef<AbortController>();
  const drag = useRef<Drag>();
  const applyingRef = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const [loaded, setLoaded] = useState<LoadedCropImage>();
  const [position, setPosition] = useState<CropPosition>(INITIAL_POSITION);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<'image' | 'export'>();

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    let decoded: LoadedCropImage | undefined;
    setLoaded(undefined);
    setPosition(INITIAL_POSITION);
    setLoading(true);
    setApplying(false);
    setError(undefined);
    applyingRef.current = false;
    drag.current = undefined;
    void loadCropImage(file, controller.signal).then((image) => {
      if (controller.signal.aborted) { image.dispose(); return; }
      decoded = image;
      setLoaded(image);
      setLoading(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setLoading(false);
      setError('image');
    });
    return () => {
      controller.abort();
      decoded?.dispose();
      drag.current = undefined;
    };
  }, [file]);

  const close = () => {
    lifecycle.current?.abort();
    drag.current = undefined;
    onCancel();
  };
  const controlsDisabled = disabled || !loaded || loading || applying;
  const reset = () => {
    if (controlsDisabled) return;
    drag.current = undefined;
    setPosition(INITIAL_POSITION);
  };
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (controlsDisabled || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    const viewportWidth = event.currentTarget.getBoundingClientRect().width;
    if (!viewportWidth) return;
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, position, viewportWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!loaded || controlsDisabled || !start || start.pointerId !== event.pointerId) return;
    const crop = getCropRect(loaded, start.position);
    setPosition(clampCropPosition(loaded, {
      ...start.position,
      centerX: start.position.centerX - (event.clientX - start.clientX) * crop.size / start.viewportWidth / loaded.width,
      centerY: start.position.centerY - (event.clientY - start.clientY) * crop.size / start.viewportWidth / loaded.height,
    }));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const moveWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!loaded || controlsDisabled) return;
    const direction = {
      ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
    }[event.key];
    if (!direction) return;
    event.preventDefault();
    const viewportWidth = event.currentTarget.getBoundingClientRect().width;
    if (!viewportWidth) return;
    const crop = getCropRect(loaded, position);
    const step = (event.shiftKey ? 1 : 10) * crop.size / viewportWidth;
    setPosition(clampCropPosition(loaded, {
      ...position,
      centerX: position.centerX + direction[0] * step / loaded.width,
      centerY: position.centerY + direction[1] * step / loaded.height,
    }));
  };
  const apply = async () => {
    const controller = lifecycle.current;
    if (!loaded || controlsDisabled || applyingRef.current || !controller || controller.signal.aborted) return;
    applyingRef.current = true;
    drag.current = undefined;
    setApplying(true);
    setError(undefined);
    try {
      const result = await exportCroppedPhoto(loaded, position, file.name, controller.signal);
      if (!controller.signal.aborted && lifecycle.current === controller && !disabledRef.current) onApply(result);
    } catch {
      if (!controller.signal.aborted) setError('export');
    } finally {
      if (!controller.signal.aborted && lifecycle.current === controller) {
        applyingRef.current = false;
        setApplying(false);
      }
    }
  };
  let imageStyle: CSSProperties | undefined;
  if (loaded) {
    const crop = getCropRect(loaded, position);
    imageStyle = {
      width: `${loaded.width / crop.size * 100}%`,
      height: `${loaded.height / crop.size * 100}%`,
      left: `${-crop.x / crop.size * 100}%`,
      top: `${-crop.y / crop.size * 100}%`,
      maxWidth: 'none',
    };
  }
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent
      aria-describedby={undefined}
      className="flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0"
      onOpenAutoFocus={(event) => { event.preventDefault(); viewport.current?.focus(); }}
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) event.preventDefault();
      }}
    >
      <DialogHeader className="shrink-0 border-b border-border px-4 py-5 pr-12 text-left sm:px-6">
        <DialogTitle>{t(titleKey)}</DialogTitle>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <div
          ref={viewport}
          role="group"
          tabIndex={0}
          aria-label={t('photoCropPreview')}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          aria-disabled={controlsDisabled}
          data-testid="photo-crop-viewport"
          className="relative mx-auto aspect-square w-full max-w-sm touch-none overflow-hidden rounded-md border border-border bg-white outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ cursor: controlsDisabled ? 'default' : 'grab' }}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={() => { drag.current = undefined; }}
          onKeyDown={moveWithKeyboard}
        >
          {loaded ? <>
            <img src={loaded.url} alt="" aria-hidden draggable={false} className="pointer-events-none absolute select-none" style={imageStyle} />
            <div aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
              {Array.from({ length: 9 }, (_, index) => <div key={index} className="border border-white/30" />)}
            </div>
          </> : null}
          {loading ? <p role="status" className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">{t('photoCropLoading')}</p> : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-4">
          <div className="min-w-0 space-y-2">
            <Label htmlFor={zoomId}>{t('photoCropZoom')}</Label>
            <input
              id={zoomId}
              type="range"
              min={MIN_CROP_ZOOM}
              max={MAX_CROP_ZOOM}
              step={0.01}
              value={position.zoom}
              disabled={controlsDisabled}
              className="block h-8 w-full cursor-pointer accent-primary disabled:cursor-default disabled:opacity-50"
              onChange={(event) => {
                if (!loaded || controlsDisabled) return;
                drag.current = undefined;
                setPosition(clampCropPosition(loaded, { ...position, zoom: Number(event.target.value) }));
              }}
            />
            <Button type="button" variant="ghost" size="sm" disabled={controlsDisabled} onClick={reset}><RotateCcw className="size-4" />{t('photoCropReset')}</Button>
          </div>
          <div role="img" aria-label={t('photoCropAvatarPreview')} className="relative aspect-square w-full overflow-hidden rounded-full border border-border bg-white">
            {loaded ? <img src={loaded.url} alt="" aria-hidden draggable={false} className="pointer-events-none absolute" style={imageStyle} /> : null}
          </div>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{t(error === 'image' ? 'photoCropImageInvalid' : 'photoCropFailed')}</p> : null}
      </div>
      <DialogFooter className="shrink-0 border-t border-border p-4 sm:px-6">
        <Button type="button" variant="outline" onClick={close}>{t('cancel')}</Button>
        <Button type="button" disabled={controlsDisabled} onClick={() => void apply()}>{applying ? t('photoCropApplying') : t('applyPhotoCrop')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
