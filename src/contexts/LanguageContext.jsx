import { createContext, useContext, useEffect, useState } from 'react';

const SUPPORTED = ['en', 'hr'];
const cache = {};

const LanguageContext = createContext(null);

function detectLang() {
  const stored = typeof localStorage !== 'undefined' && localStorage.getItem('language');
  if (stored && SUPPORTED.includes(stored)) return stored;
  if (typeof navigator === 'undefined') return 'en';
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const base = tag?.toLowerCase().split('-')[0];
    if (SUPPORTED.includes(base)) return base;
  }
  return 'en';
}

async function loadStrings(lang) {
  if (cache[lang]) return cache[lang];
  const res = await fetch(`/i18n/${lang}.json`);
  if (!res.ok) throw new Error(`Failed to load ${lang}.json: ${res.status}`);
  cache[lang] = await res.json();
  return cache[lang];
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(detectLang);
  const [strings, setStrings] = useState(cache[lang] ?? {});
  const [fallback, setFallback] = useState(cache.en ?? {});

  useEffect(() => {
    let cancelled = false;
    loadStrings(lang).then(s => {
      if (!cancelled) setStrings(s);
    });
    return () => { cancelled = true; };
  }, [lang]);

  useEffect(() => {
    let cancelled = false;
    loadStrings('en').then(s => {
      if (!cancelled) setFallback(s);
    });
    return () => { cancelled = true; };
  }, []);

  function t(key) {
    return strings[key] ?? fallback[key] ?? key;
  }

  function setLanguage(l) {
    setLang(l);
    localStorage.setItem('language', l);
  }

  return (
    <LanguageContext.Provider value={{ lang, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
