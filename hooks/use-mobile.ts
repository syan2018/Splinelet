import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const mobileSnapshot = () => window.innerWidth < MOBILE_BREAKPOINT;
const serverSnapshot = () => false;

export function useIsMobile() {
  return useSyncExternalStore(subscribe, mobileSnapshot, serverSnapshot);
}
