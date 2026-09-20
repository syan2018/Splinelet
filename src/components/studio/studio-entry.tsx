'use client';

import { useEffect, useState } from 'react';
import { createBrowserStudioHost } from '@/lib/editor/browser-studio-host';
import { createReferenceProject } from '@/lib/editor/new-reference-project.mjs';
import { createV4DraftStore } from '@/lib/persistence/v4-drafts.mjs';
import { createStudioFileWriter } from '@/lib/platform/studio-file-writer.mjs';
import StudioApp from './studio-app';

const defaultFrame = { width: 1200, height: 1200, widthMM: 100 };
const defaultPresentation = () => ({
  fileName: null,
  blenderExtrusionMM: 2,
  frame: defaultFrame,
});

type BrowserStudioHost = ReturnType<typeof createBrowserStudioHost>;

/**
 * The original Studio shell starts from the bundled reference image. Load it
 * as an owned V4 asset so the default editor never keeps a mutable legacy
 * project in React state.
 */
async function createDefaultProject() {
  const response = await fetch('/reference.png');
  if (!response.ok) throw Error('默认参考图读取失败');
  const bytes = new Uint8Array(await response.arrayBuffer());
  return createReferenceProject({
    bytes,
    mediaType: response.headers.get('content-type') || 'image/png',
    name: '角色参考图.png',
    ...defaultFrame,
  });
}

/**
 * Shared web/Tauri application entry. All document, save, and recovery state
 * is owned by one browser host before the established Studio UI is mounted.
 */
export default function StudioEntry() {
  const [host, setHost] = useState<BrowserStudioHost | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let candidate: BrowserStudioHost | null = null;
    void (async () => {
      try {
        const opened = await createDefaultProject();
        candidate = createBrowserStudioHost({
          opened,
          presentation: defaultPresentation(),
          persistence: {
            writeFile: createStudioFileWriter(),
            drafts: createV4DraftStore(),
          },
        });
        try {
          await candidate.restore(async () => defaultPresentation());
        } catch {
          // Recovery storage is optional. A malformed or unavailable draft
          // must not prevent a new document or an explicit file open.
        }
        if (!active) {
          candidate.dispose();
          return;
        }
        setHost(candidate);
      } catch (error) {
        candidate?.dispose();
        if (active)
          setFailure(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      active = false;
      candidate?.dispose();
    };
  }, []);

  if (failure)
    return (
      <main className="studio creation-studio" role="alert">
        无法启动工程：{failure}
      </main>
    );
  if (!host)
    return (
      <main className="studio creation-studio" aria-busy="true">
        正在准备工程…
      </main>
    );
  return <StudioApp host={host} />;
}
