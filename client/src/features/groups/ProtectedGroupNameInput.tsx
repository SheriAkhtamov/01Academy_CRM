import { forwardRef, type ClipboardEvent } from 'react';
import { Hash, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** One copyable name field; all edits are constrained to the suffix. */
export const ProtectedGroupNameInput = forwardRef<HTMLInputElement, {
  code: string;
  addition: string;
  onAdditionChange: (addition: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  pending?: boolean;
  className?: string;
}>(({ code, addition, onAdditionChange, onBlur, placeholder, pending, className, ...props }, ref) => {
  const value = code ? `${code}${addition ? ` — ${addition}` : ''}` : addition;
  const suffix = (name: string) => name.slice(code.length).replace(/^\s*[—–-]?\s*/, '');
  const protectSelection = (input: HTMLInputElement) => {
    input.setSelectionRange(Math.max(code.length, input.selectionStart ?? 0), Math.max(code.length, input.selectionEnd ?? 0));
  };
  const cut = (event: ClipboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    event.clipboardData.setData('text/plain', value.slice(start, end));
    event.preventDefault();
    onAdditionChange(suffix(value.slice(0, Math.max(code.length, start)) + value.slice(Math.max(code.length, end))));
  };
  return (
    <div className="relative flex items-center">
      {pending ? (
        <Loader2 className="pointer-events-none absolute left-3 size-4 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <Hash className={cn('pointer-events-none absolute left-3 size-4 transition-colors', code ? 'text-primary' : 'text-muted-foreground/70')} aria-hidden="true" />
      )}
      <Input
        {...props}
        ref={ref}
        value={value}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-busy={pending}
        className={cn(
          'pl-9 font-medium tracking-tight transition-colors',
          code && 'bg-primary/[0.02] border-primary/25 focus-visible:border-primary',
          className,
        )}
        onBeforeInput={(event) => protectSelection(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          if (event.key === 'Backspace' && event.currentTarget.selectionStart === event.currentTarget.selectionEnd
            && (event.currentTarget.selectionStart ?? 0) <= code.length) event.preventDefault();
          else if (event.key.length === 1 || ['Backspace', 'Delete'].includes(event.key)) protectSelection(event.currentTarget);
        }}
        onSelect={(event) => {
          const input = event.currentTarget;
          if (input.selectionStart === input.selectionEnd && (input.selectionStart ?? 0) < code.length) protectSelection(input);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData('text/plain');
          if (code && text.startsWith(code)) {
            event.preventDefault();
            onAdditionChange(suffix(text));
          } else protectSelection(event.currentTarget);
        }}
        onCut={cut}
        onChange={(event) => {
          if (event.target.value.startsWith(code)) onAdditionChange(suffix(event.target.value));
          else event.target.value = value;
        }}
      />
    </div>
  );
});
ProtectedGroupNameInput.displayName = 'ProtectedGroupNameInput';
