import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import StudioApp from '@/components/studio/studio-entry';
import '../../app/globals.css';
import '../../app/creation.css';

const root = document.getElementById('root');

if (!root) throw new Error('桌面应用缺少根节点');

createRoot(root).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
);
