import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { StudioDisplayProject } from '@/lib/editor/studio-display-types';
import type { CreationSelection } from '@/hooks/use-creation-selection';
import type {
  CreationDocument,
  CreationScene,
  CreationObject,
  SceneRow,
} from '../creation-types';

export type PropertyTarget = {
  kind: 'none' | 'path' | 'region' | 'shape' | 'group' | 'mixed';
  count: number;
  ownerCount: number;
  groupCount: number;
};
export type PropertyContribution = {
  id: string;
  label: string;
  title: string;
  heading: string;
  icon: LucideIcon;
  order: number;
  supports: (target: PropertyTarget) => boolean;
  Panel: ComponentType<{ context: PropertyContext }>;
};
export type PropertyContext = {
  target: PropertyTarget;
  selection: CreationSelection;
  objects: string[];
  cellKeys: string[];
  scope: 'object' | 'local' | 'source';
  project: StudioDisplayProject;
  doc: CreationDocument;
  scene: CreationScene | null;
  current?: CreationObject;
  rows: SceneRow[];
  groups: {
    groups: SceneRow[];
    shapes: SceneRow[];
    rootGroups: SceneRow[];
    singleGroup: SceneRow | null;
  };
  disabled: boolean;
  sourceOnly: boolean;
  surfaceDisabled: boolean;
  command: (action: string, args: Record<string, unknown>) => void;
  renderModifierRecovery?: (
    ownerNodeId: string,
    modifierId: string,
  ) => ReactNode;
  renderPostChain?: (ownerNodeId: string) => ReactNode;
  select: (selection: CreationSelection) => void;
  editSources: () => void;
  draw: (role: string) => void;
  newPath: () => void;
  ungroup: (ids: string[]) => void;
  managePrint: () => void;
  locateSources: (ids: string[]) => void;
  connections: ReactNode;
  color: {
    colors: (string | null)[];
    paint: (args: { color?: string; swatchId?: string }) => void;
  };
  height: {
    value: number;
    min: number;
    max: number;
    layerHeight?: number;
    active: boolean;
    activate: () => void;
    commit: (value: number) => void;
    begin: () => void;
    preview: (value: number) => void;
    finish: () => void;
    cancel: () => void;
  };
  support: {
    margin: number;
    heightMM: number;
    setMargin: (value: number) => void;
    setHeight: (value: number) => void;
    preview: () => void;
  };
  source: {
    inspector: ReactNode;
    selectedPaths: string[];
    checking: boolean;
    result?: string;
    chooseRole: (role: string) => void;
  };
};

export const surfaceTarget = (target: PropertyTarget) =>
  target.kind === 'shape' || target.kind === 'region';
