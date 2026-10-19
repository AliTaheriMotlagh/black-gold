import { en, type I18nKey } from './en';
import { fa } from './fa';
import type { Localized } from '../geo/geography';

export type Lang = 'en' | 'fa';
export type { I18nKey };

const dictionaries: Record<Lang, Record<I18nKey, string>> = { en, fa };
let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function isRTL(): boolean {
  return current === 'fa';
}

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  listeners.forEach((fn) => fn(lang));
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: I18nKey): string {
  return dictionaries[current][key] ?? en[key] ?? key;
}

export function loc(name: Localized): string {
  return name[current];
}

const faFormatter = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const enFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Locale-aware integer formatting (Persian digits in Farsi). */
export function num(n: number): string {
  return (current === 'fa' ? faFormatter : enFormatter).format(Math.floor(n));
}

export function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const str = `${m}:${s.toString().padStart(2, '0')}`;
  return current === 'fa' ? str.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : str;
}

export function detectLang(): Lang {
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('fa') ? 'fa' : 'en';
}
