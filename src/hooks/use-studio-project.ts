'use client';
import { useCallback, useSyncExternalStore } from 'react';
import type { StudioDisplayProject } from '@/lib/editor/studio-display-types';

export type StudioHost = ReturnType<
  typeof import('@/lib/editor/studio-host.mjs').createStudioHost
>;

/** The original shell reads a single V4 host; it never owns a legacy project. */
export function useStudioProject(host: StudioHost) {
  const subscribe = useCallback(
    (listener: () => void) => host.subscribe(listener),
    [host],
  );
  const getSnapshot = useCallback(() => host.getSnapshot(), [host]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    snapshot,
    project: snapshot.project as StudioDisplayProject,
  };
}
