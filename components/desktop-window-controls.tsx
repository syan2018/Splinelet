'use client';

import { Minus, Square, X } from 'lucide-react';
import {
  desktopCloseWindow,
  desktopMinimizeWindow,
  desktopToggleMaximizeWindow,
  isDesktopRuntime,
} from '@/lib/desktop-runtime.mjs';

const runWindowAction = (action: () => Promise<void>) => {
  void action().catch((error) => console.error('窗口操作失败', error));
};

export function DesktopWindowControls() {
  if (!isDesktopRuntime()) return null;

  return (
    <div className="desktop-window-controls" aria-label="窗口控制">
      <button
        type="button"
        aria-label="最小化窗口"
        title="最小化"
        onClick={() => runWindowAction(desktopMinimizeWindow)}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        aria-label="最大化或还原窗口"
        title="最大化或还原"
        onClick={() => runWindowAction(desktopToggleMaximizeWindow)}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className="desktop-window-close"
        aria-label="关闭窗口"
        title="关闭"
        onClick={() => runWindowAction(desktopCloseWindow)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
