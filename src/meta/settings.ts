import type { Lang } from '../i18n';
import type { MatchSettings } from '../game/config';

export type Quality = 'low' | 'medium' | 'high';

export interface Settings {
  lang: Lang | null;
  master: number;
  music: number;
  sfx: number;
  quality: Quality | null;
  edgeScroll: boolean;
  haptics: boolean;
  showFps: boolean;
  labels: boolean;
  lastMatch: MatchSettings;
}

const KEY = 'blackgold.settings.v1';

export const defaultSettings = (): Settings => ({
  lang: null,
  master: 0.8,
  music: 0.45,
  sfx: 0.8,
  quality: null,
  edgeScroll: true,
  haptics: true,
  showFps: false,
  labels: true,
  lastMatch: { startRegion: 'khuzestan', opponents: 1, difficulty: 'normal', startCredits: 3000, events: true },
});

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return defaultSettings();
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Pick a sensible default quality from device hints. */
export function autoQuality(): Quality {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (coarse && (mem <= 4 || cores <= 4)) return 'low';
  if (coarse) return 'medium';
  return cores >= 8 ? 'high' : 'medium';
}
