'use client';
import { useCallback, useState, useSyncExternalStore } from 'react';
import type { Project } from '@/lib/project';
import { initialTraceProject } from '@/components/source-editor/trace-editor-state';

export type StudioHost = ReturnType<
  typeof import('@/lib/editor/studio-host.mjs').createStudioHost
>;

/** The original shell can consume the V4 host without a second document store.
 * Legacy state exists only for the not-yet-switched default entry.
 */
export function useStudioProject(host?: StudioHost) {
  const [legacyProject, setLegacyProject] = useState<Project | null>(() =>
    host ? null : initialTraceProject,
  );
  const subscribe = useCallback(
    (listener: () => void) => host?.subscribe(listener) ?? (() => {}),
    [host],
  );
  const getSnapshot = useCallback(() => host?.getSnapshot() ?? null, [host]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setProject = useCallback(
    (project: Project) => {
      if (host) throw Error('V4 工程只能通过任务命令修改');
      setLegacyProject(project);
    },
    [host],
  );
  return {
    snapshot,
    project: (snapshot?.project ?? legacyProject) as Project,
    setProject,
  };
}
