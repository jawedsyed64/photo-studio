import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

window.addEventListener('error', e => console.error('Uncaught:', e.error || e.message));
createRoot(document.getElementById('root')!).render(<App />);
