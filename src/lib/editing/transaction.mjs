import { validateDocument } from '../document/schema.mjs';
import { validateDurableRegionReferences } from '../document/region-reference-validation.mjs';
import { evaluatePlanar } from '../construction/document-evaluation.mjs';
import {
  hasUnboundRegionReferences,
  bindReferencedRegions,
} from '../construction/region-definitions.mjs';

const clone = (value) => structuredClone(value);

const commandResult = (result) => {
  if (!result || typeof result !== 'object' || !('document' in result))
    throw Error('编辑命令必须返回 { document, changedRefs, selectionIntent? }');
  return result;
};

// Context contains injected capabilities such as idFactory, which are not
// structured-cloneable. It never includes the authoritative Document.
const context = (value) => Object.freeze({ ...value });

const bindSelectedRegions = (candidate, options) => {
  if (!hasUnboundRegionReferences(candidate.document)) return;
  const planar = evaluatePlanar(candidate.document);
  bindReferencedRegions(
    candidate.document,
    planar,
    options.context?.idFactory || (() => globalThis.crypto.randomUUID()),
    [candidate.changedRefs, candidate.selectionIntent],
  );
};

export function executeTransaction(document, command, options = {}) {
  if (typeof command !== 'function') throw Error('编辑命令必须是函数');
  if (hasUnboundRegionReferences(document))
    throw Error('作者文档不能包含临时面句柄');
  const result = command(clone(document), context(options.context || {}));
  if (result && typeof result.then === 'function')
    throw Error('异步命令必须先通过 prepare 准备，再用 dispatch 提交');
  const candidate = commandResult(result);
  bindSelectedRegions(candidate, options);
  const validator = options.validator || validateDocument;
  validator(candidate.document);
  validateDurableRegionReferences(candidate.document);
  return {
    document: clone(candidate.document),
    changedRefs: clone(candidate.changedRefs || []),
    selectionIntent: clone(candidate.selectionIntent),
  };
}

export async function prepareTransaction(document, command, options = {}) {
  if (typeof command !== 'function') throw Error('编辑命令必须是函数');
  if (hasUnboundRegionReferences(document))
    throw Error('作者文档不能包含临时面句柄');
  const result = await command(clone(document), context(options.context || {}));
  const candidate = commandResult(result);
  bindSelectedRegions(candidate, options);
  const validator = options.validator || validateDocument;
  validator(candidate.document);
  validateDurableRegionReferences(candidate.document);
  return {
    document: clone(candidate.document),
    changedRefs: clone(candidate.changedRefs || []),
    selectionIntent: clone(candidate.selectionIntent),
  };
}
