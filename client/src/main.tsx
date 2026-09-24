import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { reportClientCrash, reserveCrashReload } from './lib/clientCrash';

window.addEventListener('vite:preloadError', (event) => {
  reportClientCrash((event as Event & { payload?: unknown }).payload, 'module-preload');
  if (reserveCrashReload()) window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
