import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { I18nProvider } from '@/locale';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// В продакшене без StrictMode, чтобы избежать двойных запросов
if (import.meta.env.PROD) {
  root.render(
    <I18nProvider>
      <App />
    </I18nProvider>
  );
} else {
  root.render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>
  );
}