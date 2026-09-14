import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installTextMeasurer } from '@/render/renderer';
import { App } from './App';
import './styles/global.css';

// Text layout needs real glyph widths before the first frame is drawn.
installTextMeasurer();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
