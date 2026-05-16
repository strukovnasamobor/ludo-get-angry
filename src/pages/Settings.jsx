import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import './Settings.css';

export default function Settings() {
  const navigate = useNavigate();
  const { t, lang, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="settings-page page">
      <div className="settings-header">
        <button className="btn btn-ghost setup-back-btn" onClick={() => navigate('/')}>←</button>
        <h2 className="settings-title">{t('settingsTitle')}</h2>
      </div>

      <div className="settings-scroll">
        <div className="setting-group card">
          <span className="setting-label">{t('settingsTheme')}</span>
          <div className="setting-toggle-row">
            <button
              className={`toggle-option ${theme === 'light' ? 'toggle-option--active' : ''}`}
              onClick={() => theme !== 'light' && toggleTheme()}
            >
              ☀️ {t('settingsThemeLight')}
            </button>
            <button
              className={`toggle-option ${theme === 'dark' ? 'toggle-option--active' : ''}`}
              onClick={() => theme !== 'dark' && toggleTheme()}
            >
              🌙 {t('settingsThemeDark')}
            </button>
          </div>
        </div>

        <div className="setting-group card">
          <span className="setting-label">{t('settingsLang')}</span>
          <div className="setting-toggle-row">
            <button
              className={`toggle-option ${lang === 'hr' ? 'toggle-option--active' : ''}`}
              onClick={() => setLanguage('hr')}
            >
              🇭🇷 Hrvatski
            </button>
            <button
              className={`toggle-option ${lang === 'en' ? 'toggle-option--active' : ''}`}
              onClick={() => setLanguage('en')}
            >
              🇬🇧 English
            </button>
          </div>
        </div>

        <div className="setting-group card">
          <span className="setting-label">{t('settingsLegal')}</span>
          <div className="setting-links">
            <a
              className="setting-link"
              href="/privacy_policy.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>🔒 {t('settingsPrivacy')}</span>
              <span className="setting-link-icon" aria-hidden="true">↗</span>
            </a>
            <a
              className="setting-link"
              href="/terms_and_conditions.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>📜 {t('settingsTerms')}</span>
              <span className="setting-link-icon" aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}