import { Disc3, Heart, Sparkles, type LucideIcon } from 'lucide-react';

import type { TranslationKey } from '@/i18n';
import type { DailyPlaylist } from '@/lib/recommendations';

/**
 * Visual + i18n metadata for each "Плейлист дня" variant. Shared by
 * the /home grid card and the /daily/:id preview page so the two
 * surfaces always agree on hue, label, name and description copy.
 */
export interface DailyVariantTheme {
  hue: string;
  labelKey: TranslationKey;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  icon: LucideIcon;
}

export const DAILY_VARIANT_THEME: Record<DailyPlaylist['variant'], DailyVariantTheme> = {
  familiar: {
    hue: '#5E6AD2',
    labelKey: 'home.dailyVariantFamiliar',
    nameKey: 'home.dailyVariantFamiliarName',
    descKey: 'home.dailyVariantFamiliarDescription',
    icon: Heart,
  },
  discover: {
    hue: '#c2185b',
    labelKey: 'home.dailyVariantDiscover',
    nameKey: 'home.dailyVariantDiscoverName',
    descKey: 'home.dailyVariantDiscoverDescription',
    icon: Sparkles,
  },
  mood: {
    hue: '#0ea5e9',
    labelKey: 'home.dailyVariantMood',
    nameKey: 'home.dailyVariantMoodName',
    descKey: 'home.dailyVariantMoodDescription',
    icon: Disc3,
  },
};

/**
 * Pluralization key for daily-playlist track counts. Returns the i18n
 * key whose value is the noun form (`трек` / `трека` / `треков` in
 * Russian, `track` / `tracks` in English) appropriate for the count.
 */
export function dailyTrackUnitKey(count: number): TranslationKey {
  const m100 = count % 100;
  if (m100 >= 11 && m100 <= 14) return 'home.dailyTrackUnit5plus';
  const m10 = count % 10;
  if (m10 === 1) return 'home.dailyTrackUnit1';
  if (m10 >= 2 && m10 <= 4) return 'home.dailyTrackUnit2_4';
  return 'home.dailyTrackUnit5plus';
}
