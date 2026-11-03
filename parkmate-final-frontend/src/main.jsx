import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App.jsx';
import { ThemeProvider } from './app/ThemeContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { initMonitoring } from './lib/monitoring.js';
import { AuthProvider } from './features/auth/AuthContext.jsx';
import { MarketplaceProvider } from './app/MarketplaceContext.jsx';
import './styles/global.css';
import './styles/app.css';
import './styles/redesign.css';
import './styles/theme.css';
import './styles/dashboard-ui.css';
import './styles/map-fixes.css';
import './styles/photo-upload.css';
import './styles/auth-ui.css';

initMonitoring();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <MarketplaceProvider>
            <App />
          </MarketplaceProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
