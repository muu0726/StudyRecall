import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AuthGate from './components/AuthGate';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './contexts/ThemeProvider';
import { usePwaUpdate } from './hooks/usePwaUpdate';
import './index.css';

/**
 * Service Worker の登録と更新の通知。**AuthGate の外に置く。**
 *
 * 中に置いていたため、**ログインするまで Service Worker が登録されなかった。**
 * ブラウザは「アプリとして追加」の可否を最初の訪問で判断するので、
 * 初めて開いた人（＝ログイン画面）にはインストールの選択肢が出ないままだった。
 */
function PwaRegistrar() {
  usePwaUpdate();
  return null;
}

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つかりません');

createRoot(container).render(
  <StrictMode>
    {/* ログイン画面もテーマに従わせたいので AuthGate より外に置く */}
    <ThemeProvider>
      <ToastProvider>
        <PwaRegistrar />
        <AuthGate>
          <App />
        </AuthGate>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
