import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { MobileErrorBoundary } from "./components/mobile-error-boundary";

// Mobile compatibility check and fixes
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const isKakaoTalk = /KAKAOTALK/i.test(navigator.userAgent);

// Force viewport settings for mobile
if (isMobile || isKakaoTalk) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=5, user-scalable=yes');
  }
}

// Polyfill for older mobile browsers
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = function(callback) {
    return window.setTimeout(callback, 1000 / 60);
  };
}

createRoot(document.getElementById("root")!).render(
  <MobileErrorBoundary>
    <App />
  </MobileErrorBoundary>
);
