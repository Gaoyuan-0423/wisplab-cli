import { useEffect, useState, type ReactNode } from 'react';
import type { Language } from './translate';
import { initialLanguage, LANGUAGE_KEY, LanguageContext, useI18n } from './locale';
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = language === 'zh' ? 'WispLab实验数据分析 · PCR 工作台' : 'WispLab Experimental Data Analysis · PCR Workbench';
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* UI still works without storage. */ }
    const next = new URL(window.location.href);
    next.searchParams.set('lang', language);
    window.history.replaceState(window.history.state, '', next);
  }, [language]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === LANGUAGE_KEY && (event.newValue === 'zh' || event.newValue === 'en')) setLanguage(event.newValue);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}

export function LanguageSwitch() {
  const { language, setLanguage } = useI18n();
  return <div className="language-switch" role="group" aria-label="中文 / English">
    <button type="button" lang="zh-CN" aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
    <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
  </div>;
}
