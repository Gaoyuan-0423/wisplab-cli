import { createContext, useCallback, useContext } from 'react';
import { translate, type Language } from './translate';
export const LANGUAGE_KEY = 'wisplab.lang';
export function resolveLanguage(search: string, stored: string | null): Language {
  const query = new URLSearchParams(search).get('lang');
  return query === 'zh' || query === 'en' ? query : stored === 'en' ? 'en' : 'zh';
}
export function withLanguage(href: string, language: Language): string {
  const url = new URL(href, typeof window === 'undefined' ? 'https://wisplab.top/' : window.location.href);
  url.searchParams.set('lang', language);
  return url.href;
}
export function initialLanguage(): Language {
  if (typeof window === 'undefined') return 'zh';
  let stored: string | null = null;
  try { stored = localStorage.getItem(LANGUAGE_KEY); } catch { /* Storage may be blocked. */ }
  return resolveLanguage(window.location.search, stored);
}

export const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({ language: 'zh', setLanguage: () => {} });
export function useI18n() {
  const { language, setLanguage } = useContext(LanguageContext);
  const t = useCallback((source: string, params?: readonly unknown[]) => translate(source, language, params), [language]);
  return { language, setLanguage, t };
}
