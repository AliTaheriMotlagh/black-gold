import type { I18nKey } from '../i18n';

export type AchievementId =
  | 'firstBlood'
  | 'oilBaron'
  | 'tycoon'
  | 'ironDome'
  | 'conqueror'
  | 'annihilator'
  | 'nuke'
  | 'victory'
  | 'general'
  | 'blitz'
  | 'survivor';

export const ACHIEVEMENTS: { id: AchievementId; icon: string; xp: number }[] = [
  { id: 'firstBlood', icon: '🎯', xp: 50 },
  { id: 'oilBaron', icon: '🛢️', xp: 150 },
  { id: 'tycoon', icon: '💰', xp: 120 },
  { id: 'ironDome', icon: '🛡️', xp: 200 },
  { id: 'conqueror', icon: '🏙️', xp: 200 },
  { id: 'annihilator', icon: '💀', xp: 250 },
  { id: 'nuke', icon: '🚀', xp: 150 },
  { id: 'victory', icon: '🏆', xp: 200 },
  { id: 'general', icon: '⭐', xp: 500 },
  { id: 'blitz', icon: '⚡', xp: 300 },
  { id: 'survivor', icon: '🦅', xp: 400 },
];

export const achName = (id: AchievementId) => `ach.${id}` as I18nKey;
export const achDesc = (id: AchievementId) => `ach.${id}.desc` as I18nKey;

export interface Profile {
  xp: number;
  games: number;
  wins: number;
  bestScore: number;
  achievements: AchievementId[];
}

const KEY = 'blackgold.profile.v1';

/** XP thresholds for ranks 0..9. */
export const RANK_XP = [0, 300, 800, 1600, 2800, 4500, 7000, 10000, 14000, 20000];

export function rankOf(xp: number): number {
  let r = 0;
  for (let i = 0; i < RANK_XP.length; i++) if (xp >= RANK_XP[i]) r = i;
  return r;
}

export function rankProgress(xp: number): number {
  const r = rankOf(xp);
  if (r >= RANK_XP.length - 1) return 1;
  return (xp - RANK_XP[r]) / (RANK_XP[r + 1] - RANK_XP[r]);
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { xp: 0, games: 0, wins: 0, bestScore: 0, achievements: [], ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { xp: 0, games: 0, wins: 0, bestScore: 0, achievements: [] };
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Returns true if newly unlocked. */
export function unlock(p: Profile, id: AchievementId): boolean {
  if (p.achievements.includes(id)) return false;
  p.achievements.push(id);
  p.xp += ACHIEVEMENTS.find((a) => a.id === id)?.xp ?? 0;
  saveProfile(p);
  return true;
}
