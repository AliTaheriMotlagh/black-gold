import type { Lang } from '../i18n';
import type { Quality } from '../render/Stage';
import type { ImageryProvider } from '../render/terrain/TileSource';
import type { Difficulty } from '../sim/country';

export interface SetupPrefs {
  country: string;
  rivals: string[];
  difficulty: Difficulty;
  scenario: 'sandbox' | 'realistic';
  funds: number;
  events: boolean;
  timeLimit: number;
}

export interface Settings {
  lang: Lang | null;
  master: number;
  music: number;
  sfx: number;
  quality: Quality | null;
  imagery: ImageryProvider;
  edgeScroll: boolean;
  haptics: boolean;
  showFps: boolean;
  labels: boolean;
  uiScale: number;
  name: string;
  setup: SetupPrefs;
}

const KEY = 'blackgold.settings.v2';

export const defaultSettings = (): Settings => ({
  lang: null,
  master: 0.8,
  music: 0.4,
  sfx: 0.85,
  quality: null,
  imagery: 's2',
  edgeScroll: true,
  haptics: true,
  showFps: false,
  labels: true,
  uiScale: 1,
  name: '',
  setup: { country: 'IRN', rivals: ['SAU', 'TUR', 'ISR'], difficulty: 'normal', scenario: 'realistic', funds: 5000, events: true, timeLimit: 0 },
});

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...defaultSettings(), ...JSON.parse(raw) } as Settings;
      s.setup = { ...defaultSettings().setup, ...s.setup };
      return s;
    }
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
