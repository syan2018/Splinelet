import { resolvePropertyContributions } from '@/lib/editor/property-contributions.mjs';
import { shapeProperties } from './shape-properties';
import { hierarchyProperties } from './hierarchy-properties';
import { sourceProperties } from './source-properties';
import { appearanceProperties } from './appearance-properties';
import { reliefProperties } from './relief-properties';
import { placementProperties } from './placement-properties';
import { constructionProperties } from './construction-properties';
import { outputProperties } from './output-properties';
import { supportProperties } from './support-properties';
import type { PropertyContribution, PropertyTarget } from './property-context';

// The composition root registers pages. Their applicability, content and
// presentation are owned by each domain contribution, not the workspace.
export const selectionPropertyContributions: readonly PropertyContribution[] =
  Object.freeze([
    shapeProperties,
    hierarchyProperties,
    sourceProperties,
    appearanceProperties,
    reliefProperties,
    placementProperties,
    constructionProperties,
    outputProperties,
    supportProperties,
  ]);
export const selectionPropertiesFor = (
  target: PropertyTarget,
): PropertyContribution[] =>
  resolvePropertyContributions(selectionPropertyContributions, target);
export const isSelectionPropertyPage = (id: string) =>
  selectionPropertyContributions.some((entry) => entry.id === id);
