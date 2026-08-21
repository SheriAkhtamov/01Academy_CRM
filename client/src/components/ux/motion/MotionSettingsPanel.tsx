import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { DEFAULT_MOTION_PREFERENCES, MOTION_FEATURES, type MotionFeature } from '@/lib/motionPreferences';
import { useMotionPreferences } from './MotionPreferencesProvider';

/**
 * One row per switch, in the order someone would reach for them: the two that
 * fire on every single interaction first, ornament last.
 */
const FEATURE_LABELS = {
  pageTransitions: { labelKey: 'motionPageTransitions', hintKey: 'motionPageTransitionsHint' },
  entrances: { labelKey: 'motionEntrances', hintKey: 'motionEntrancesHint' },
  boardReflow: { labelKey: 'motionBoardReflow', hintKey: 'motionBoardReflowHint' },
  charts: { labelKey: 'motionCharts', hintKey: 'motionChartsHint' },
  decorative: { labelKey: 'motionDecorative', hintKey: 'motionDecorativeHint' },
} satisfies Record<MotionFeature, { labelKey: TranslationKey; hintKey: TranslationKey }>;

/**
 * The animation switches shown inside Account Settings.
 *
 * They apply the moment they are flipped rather than on save: the whole point
 * is to feel the difference, and the preference is device-local anyway, so
 * there is nothing for the server round-trip to carry.
 */
export function MotionSettingsPanel() {
  const { t } = useTranslation();
  const { preferences, setPreference, resetPreferences } = useMotionPreferences();
  const isDefault = MOTION_FEATURES.every((feature) => preferences[feature])
    && preferences.enabled === DEFAULT_MOTION_PREFERENCES.enabled;

  return (
    <div className="rounded-xl border border-border/70 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="motion-enabled" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-slate-500" />
            {t('interfaceAnimations')}
          </Label>
          <p className="text-xs text-muted-foreground">{t('interfaceAnimationsHint')}</p>
        </div>
        <Switch
          id="motion-enabled"
          checked={preferences.enabled}
          onCheckedChange={(checked) => setPreference('enabled', checked)}
        />
      </div>

      <div
        className={`mt-4 space-y-3 border-t border-border/70 pt-4 ${
          preferences.enabled ? '' : 'opacity-50'
        }`}
      >
        {MOTION_FEATURES.map((feature) => (
          <div key={feature} className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor={`motion-${feature}`} className="text-sm font-normal">
                {t(FEATURE_LABELS[feature].labelKey)}
              </Label>
              <p className="text-xs text-muted-foreground">{t(FEATURE_LABELS[feature].hintKey)}</p>
            </div>
            <Switch
              id={`motion-${feature}`}
              disabled={!preferences.enabled}
              checked={preferences.enabled && preferences[feature]}
              onCheckedChange={(checked) => setPreference(feature, checked)}
            />
          </div>
        ))}
      </div>

      {isDefault ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-3 h-8 px-2 text-xs"
          onClick={resetPreferences}
        >
          {t('motionResetDefaults')}
        </Button>
      )}
    </div>
  );
}
