import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/700.css';
import './landing.css';

// Register the service worker early so the game shell is cached before the first play.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
// Warm up the game's data while the visitor reads.
const warm = () => {
  const l = document.createElement('link');
  l.rel = 'prefetch';
  l.href = '/data/theater.bin.gz';
  document.head.append(l);
};
if ('requestIdleCallback' in window) requestIdleCallback(warm);
else setTimeout(warm, 2000);
