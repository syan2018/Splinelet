import { exportSourceBlender, exportSourceSvg } from '@/lib/source-export';
import type { StudioDisplayProject } from './studio-display-types';

/** Source exports consume the V4 display projection without invoking legacy encoders. */
export function exportStudioDisplaySvg(project: StudioDisplayProject) {
  return exportSourceSvg(project);
}

export function exportStudioDisplayBlender(project: StudioDisplayProject) {
  return exportSourceBlender(project);
}
