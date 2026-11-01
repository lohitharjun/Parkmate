import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App.jsx';
import { ThemeProvider } from './app/ThemeContext.jsx';
import { AuthProvider } from './features/auth/AuthContext.jsx';
import { MarketplaceProvider } from './app/MarketplaceContext.jsx';
import './styles/global.css';
import './styles/app.css';
import './styles/redesign.css';
import './styles/theme.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <MarketplaceProvider>
            <App />
          </MarketplaceProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
