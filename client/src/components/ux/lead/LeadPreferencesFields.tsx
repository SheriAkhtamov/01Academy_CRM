import { useFormContext } from 'react-hook-form';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { LocalizedFormMessage } from '@/components/ux/lead/LeadSheetControls';
import { FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LEAD_LOCALITIES, LEAD_STUDY_DAYS, LEAD_STUDY_TIMES } from '@shared/lead-preferences';

export const localityKeys = {
  bektemir: 'leadDistrictBektemir',
  chilanzar: 'leadDistrictChilanzar',
  mirabad: 'leadDistrictMirabad',
  mirzo_ulugbek: 'leadDistrictMirzoUlugbek',
  olmazor: 'leadDistrictOlmazor',
  sergeli: 'leadDistrictSergeli',
  shaykhontohur: 'leadDistrictShaykhontohur',
  uchtepa: 'leadDistrictUchtepa',
  yakkasaray: 'leadDistrictYakkasaray',
  yangihayot: 'leadDistrictYangihayot',
  yashnabad: 'leadDistrictYashnabad',
  yunusabad: 'leadDistrictYunusabad',
  region: 'leadDistrictRegion',
} as const satisfies Record<(typeof LEAD_LOCALITIES)[number], TranslationKey>;

export const studyDaysKeys = {
  even: 'leadStudyDaysEven',
  odd: 'leadStudyDaysOdd',
  weekend: 'leadStudyDaysWeekend',
} as const satisfies Record<(typeof LEAD_STUDY_DAYS)[number], TranslationKey>;

type LeadPreferenceFields = {
  locality: string;
  studyDays: string;
  studyTime: string;
  goal: string;
  urgency: string;
};

export function LeadPreferencesFields() {
  const { t } = useTranslation();
  const form = useFormContext<LeadPreferenceFields>();
  return (
    <>
      <FormField
        control={form.control}
        name="locality"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('leadLocality')}</FormLabel>
            <Select value={field.value || '__none__'} onValueChange={(value) => field.onChange(value === '__none__' ? '' : value)}>
              <FormControl><SelectTrigger ref={field.ref} aria-invalid={fieldState.invalid}><SelectValue placeholder={t('leadLocalitySelect')} /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="__none__">{t('leadClearSelection')}</SelectItem>
                {LEAD_LOCALITIES.map((locality) => (
                  <SelectItem key={locality} value={locality}>{t(localityKeys[locality])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LocalizedFormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="studyDays"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('leadStudyDays')}</FormLabel>
            <Select value={field.value || '__none__'} onValueChange={(value) => field.onChange(value === '__none__' ? '' : value)}>
              <FormControl><SelectTrigger ref={field.ref} aria-invalid={fieldState.invalid}><SelectValue placeholder={t('leadStudyDaysSelect')} /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="__none__">{t('leadClearSelection')}</SelectItem>
                {LEAD_STUDY_DAYS.map((days) => (
                  <SelectItem key={days} value={days}>{t(studyDaysKeys[days])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LocalizedFormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="studyTime"
        render={({ field, fieldState }) => (
          <FormItem>
            <FormLabel>{t('leadStudyTime')}</FormLabel>
            <Select value={field.value || '__none__'} onValueChange={(value) => field.onChange(value === '__none__' ? '' : value)}>
              <FormControl><SelectTrigger ref={field.ref} aria-invalid={fieldState.invalid}><SelectValue placeholder={t('leadStudyTimeSelect')} /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="__none__">{t('leadClearSelection')}</SelectItem>
                {LEAD_STUDY_TIMES.map((time) => (
                  <SelectItem key={time} value={time}>{time}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <LocalizedFormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="goal"
        render={({ field, fieldState }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>{t('leadGoal')}</FormLabel>
            <FormControl><Textarea {...field} rows={2} aria-invalid={fieldState.invalid} /></FormControl>
            <LocalizedFormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="urgency"
        render={({ field, fieldState }) => (
          <FormItem className="md:col-span-2">
            <FormLabel>{t('leadUrgency')}</FormLabel>
            <FormControl><Textarea {...field} rows={2} aria-invalid={fieldState.invalid} /></FormControl>
            <LocalizedFormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
