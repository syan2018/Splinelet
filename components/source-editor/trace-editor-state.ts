import type { Point, Project } from '@/lib/project';

export const initialTraceProject: Project = {
  version: 1,
  image: '/reference.png',
  imageName: '角色参考图.png',
  width: 1200,
  height: 1200,
  paths: [],
  widthMM: 100,
  depthMM: 2,
};

export type TraceCandidate = Point & { id: string; score: number };

export type TraceSettings = {
  mode: 'ink' | 'edge' | 'manual';
  tolerance: number;
  corridor: number;
  snap: boolean;
};

export const cloneTraceValue = <T,>(value: T): T => structuredClone(value);
