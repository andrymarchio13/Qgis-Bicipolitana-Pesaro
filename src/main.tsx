import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import { App } from './App';
import { ErrorBoundary } from './components/UI/ErrorBoundary';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root non trovato.');

createRoot(container).render(
  <React.StrictMode>
    {/*
      HashRouter: GitHub Pages serve solo file statici e non sa riscrivere le
      rotte lato server. Con l'hash ogni URL profondo (es. /linea/3) resta
      raggiungibile anche ricaricando la pagina.
    */}
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>,
);
