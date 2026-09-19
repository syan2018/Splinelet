'use client';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import StudioApp from './studio-app';
const V4StudioApp = lazy(() => import('./v4/v4-studio-app'));
const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};
const candidate = () =>
  new URLSearchParams(window.location.search).get('editor') === 'v4';
/** Candidate entry shared by both hosts. Default switch remains gated by acceptance. */
export default function StudioEntry() {
  const mode = useSyncExternalStore(subscribe, candidate, () => null);
  if (mode === null) return <p>正在打开编辑器…</p>;
  return mode ? (
    <Suspense fallback={<p>正在打开编辑器…</p>}>
      <V4StudioApp />
    </Suspense>
  ) : (
    <StudioApp />
  );
}
