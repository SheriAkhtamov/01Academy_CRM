import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { leadsApi } from '@/features/leads/api';
import { invalidateLeadData } from '@/features/leads/queries';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, LockKeyhole, Plus, Tag, X } from 'lucide-react';
import {
  MAX_LEAD_TAG_NAME_LENGTH,
  leadTagNameKey,
  normalizeLeadTagName,
  type LeadTagOption,
  type LeadTagView,
} from '@shared/lead-tags';

export interface LeadTagsEditorProps {
  leadId: number;
  automaticTag?: string | null;
  tags?: LeadTagView[];
  onChanged: () => void;
  onDropdownOpenChange: (open: boolean) => void;
}

type LeadTagSuggestion =
  | {
      key: string;
      kind: 'existing';
      name: string;
      option: LeadTagOption;
    }
  | {
      key: string;
      kind: 'create';
      name: string;
    };

export function LeadTagsEditor({
  leadId,
  automaticTag,
  tags = [],
  onChanged,
  onDropdownOpenChange,
}: LeadTagsEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [customTagName, setCustomTagName] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [tagToRemove, setTagToRemove] = useState<LeadTagView | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `lead-${leadId}-tag-options`;

  const tagOptionsQuery = useQuery<LeadTagOption[]>({
    queryKey: ['/api/academy/lead-tags'],
  });

  const automaticTagKey = leadTagNameKey(automaticTag);
  const manualTags = tags;
  const assignedTagKeys = useMemo(
    () => new Set([
      automaticTagKey,
      ...tags.map((tag) => leadTagNameKey(tag.name)),
    ].filter(Boolean)),
    [automaticTagKey, tags],
  );
  const availableOptions = useMemo(
    () => (tagOptionsQuery.data ?? []).filter((option) => (
      !assignedTagKeys.has(leadTagNameKey(option.name))
    )),
    [assignedTagKeys, tagOptionsQuery.data],
  );
  const normalizedCustomTag = normalizeLeadTagName(customTagName);
  const customTagKey = normalizedCustomTag?.normalizedName ?? '';
  const matchingOptions = useMemo(
    () => availableOptions
      .filter((option) => (
        !customTagKey || leadTagNameKey(option.name).includes(customTagKey)
      ))
      .slice(0, 8),
    [availableOptions, customTagKey],
  );
  const exactOption = availableOptions.find(
    (option) => leadTagNameKey(option.name) === customTagKey,
  );
  const canAddCustomTag = Boolean(
    normalizedCustomTag
      && !assignedTagKeys.has(normalizedCustomTag.normalizedName)
      && !exactOption,
  );
  const suggestions: LeadTagSuggestion[] = [
    ...(normalizedCustomTag && canAddCustomTag
      ? [{
          key: `create:${normalizedCustomTag.normalizedName}`,
          kind: 'create' as const,
          name: normalizedCustomTag.name,
        }]
      : []),
    ...matchingOptions.map((option) => ({
      key: option.id === null
        ? `source:${leadTagNameKey(option.name)}`
        : `tag:${option.id}`,
      kind: 'existing' as const,
      name: option.name,
      option,
    })),
  ];
  const resolvedActiveSuggestionIndex = suggestions.length === 0
    ? -1
    : Math.min(activeSuggestionIndex, suggestions.length - 1);
  const activeSuggestion = suggestions[resolvedActiveSuggestionIndex];

  const refreshTags = async () => {
    await invalidateLeadData(queryClient, leadId);
    onChanged();
  };

  const addTag = useMutation({
    mutationFn: (payload: { tagId: number } | { name: string }) =>
      leadsApi.addTag<{ created?: boolean }>(leadId, payload),
    onSuccess: async (result: { created?: boolean }) => {
      setCustomTagName('');
      setIsOpen(false);
      onDropdownOpenChange(false);
      setActiveSuggestionIndex(0);
      await refreshTags();
      toast({
        title: result.created ? t('leadTagAdded') : t('leadTagAlreadyAssigned'),
      });
    },
    onError: (error: Error) => toast({
      title: t('leadTagAddFailed'),
      description: error.message,
      variant: 'destructive',
    }),
  });

  const removeTag = useMutation({
    mutationFn: (tag: LeadTagView) =>
      leadsApi.removeTag(leadId, tag.id),
    onSuccess: async () => {
      setTagToRemove(null);
      await refreshTags();
      toast({ title: t('leadTagRemoved') });
    },
    onError: (error: Error) => {
      toast({
        title: t('leadTagRemoveFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
  const isBusy = addTag.isPending || removeTag.isPending;
  const setDropdownOpen = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    onDropdownOpenChange(nextOpen);
  };

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!editorRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        onDropdownOpenChange(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [isOpen, onDropdownOpenChange]);

  const submitSuggestion = (suggestion: LeadTagSuggestion | undefined) => {
    if (!suggestion || isBusy) return;
    if (suggestion.kind === 'existing') {
      addTag.mutate(
        suggestion.option.id === null
          ? { name: suggestion.option.name }
          : { tagId: suggestion.option.id },
      );
      return;
    }
    addTag.mutate({ name: suggestion.name });
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setDropdownOpen(true);
      if (suggestions.length === 0) return;
      setActiveSuggestionIndex((current) => {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        return (current + direction + suggestions.length) % suggestions.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      submitSuggestion(activeSuggestion);
    }
  };

  return (
    <div
      ref={editorRef}
      className="text-left"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropdownOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault();
          setDropdownOpen(false);
        }
      }}
    >
      <label htmlFor={`lead-${leadId}-tag-input`} className="sr-only">
        {t('leadTags')}
      </label>
      <span id={`lead-${leadId}-tag-hint`} className="sr-only">
        {t('leadTagsHint')}
      </span>

      <div className="relative">
        <div
          className="flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-transparent bg-muted/50 px-2 py-1 transition-[background-color,border-color,box-shadow] hover:bg-muted/70 focus-within:border-input focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/15"
          onMouseDown={(event) => {
            const target = event.target as Element;
            if (target.closest('button, input')) return;
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Tag className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {automaticTag ? (
            <Badge
              variant="outline"
              className="h-6 max-w-full shrink-0 gap-1 px-2 py-0"
              title={t('automaticTag')}
            >
              <span className="truncate">{automaticTag}</span>
              <LockKeyhole className="size-3 shrink-0" aria-hidden="true" />
              <span className="sr-only">{t('automaticTag')}</span>
            </Badge>
          ) : null}
          {manualTags.map((tag) => {
            const isRemoving = removeTag.isPending && removeTag.variables?.id === tag.id;
            return (
              <Badge
                key={tag.id}
                variant="secondary"
                className="h-6 max-w-full shrink-0 gap-1 py-0 pl-2 pr-1"
              >
                <span className="truncate">{tag.name}</span>
                <button
                  type="button"
                  className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
                  aria-label={`${t('removeLeadTag')} ${tag.name}`}
                  disabled={isBusy}
                  onClick={() => {
                    setDropdownOpen(false);
                    setTagToRemove(tag);
                  }}
                >
                  {isRemoving ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="size-3" aria-hidden="true" />
                  )}
                </button>
              </Badge>
            );
          })}

          <input
            ref={inputRef}
            id={`lead-${leadId}-tag-input`}
            role="combobox"
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={isOpen}
            aria-activedescendant={
              isOpen && activeSuggestion
                ? `${listboxId}-option-${resolvedActiveSuggestionIndex}`
                : undefined
            }
            aria-describedby={`lead-${leadId}-tag-hint`}
            autoComplete="off"
            className="h-6 min-w-32 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-wait"
            value={customTagName}
            maxLength={MAX_LEAD_TAG_NAME_LENGTH}
            placeholder={t('customTagPlaceholder')}
            disabled={isBusy}
            onFocus={() => {
              setActiveSuggestionIndex(0);
              setDropdownOpen(true);
            }}
            onChange={(event) => {
              setCustomTagName(event.target.value);
              setActiveSuggestionIndex(0);
              setDropdownOpen(true);
            }}
            onKeyDown={handleInputKeyDown}
          />
          {addTag.isPending || tagOptionsQuery.isLoading ? (
            <Loader2 className="mr-1 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : null}
        </div>

        {isOpen ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label={t('selectTag')}
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          >
            {tagOptionsQuery.isLoading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t('loading')}
              </div>
            ) : null}
            {tagOptionsQuery.isError ? (
              <div className="px-2 py-2 text-sm text-destructive">
                {t('leadTagsLoadFailed')}
              </div>
            ) : null}
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.key}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === resolvedActiveSuggestionIndex}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveSuggestionIndex(index)}
                onClick={() => submitSuggestion(suggestion)}
              >
                {suggestion.kind === 'create' ? (
                  <Plus className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <Tag className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {suggestion.kind === 'create'
                    ? `${t('addTag')}: “${suggestion.name}”`
                    : suggestion.name}
                </span>
              </button>
            ))}
            {!tagOptionsQuery.isLoading
              && !tagOptionsQuery.isError
              && suggestions.length === 0 ? (
                <div className="px-2 py-2 text-sm text-muted-foreground">
                  {customTagKey && assignedTagKeys.has(customTagKey)
                    ? t('leadTagAlreadyAssigned')
                    : t('noTagOptions')}
                </div>
              ) : null}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={tagToRemove !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !removeTag.isPending) setTagToRemove(null);
        }}
        title={t('removeLeadTag')}
        description={tagToRemove
          ? t('removeLeadTagConfirm').replace('{tag}', tagToRemove.name)
          : ''}
        confirmLabel={t('delete')}
        variant="destructive"
        isPending={removeTag.isPending}
        keepOpenOnConfirm
        onConfirm={() => {
          if (tagToRemove) removeTag.mutate(tagToRemove);
        }}
      />
    </div>
  );
}
