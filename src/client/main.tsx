import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AuthGate from './components/AuthGate';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './contexts/ThemeProvider';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つかりません');

createRoot(container).render(
  <StrictMode>
    {/* ログイン画面もテーマに従わせたいので AuthGate より外に置く */}
    <ThemeProvider>
      <ToastProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
