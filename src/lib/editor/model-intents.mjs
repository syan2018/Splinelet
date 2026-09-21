import { createAuthoringCommand } from '../editing/commands/authoring.mjs';
import { resolveThicknessMM } from '../manufacturing/dimensions.mjs';
import { compileModelFeatureChange } from './model-panel-adapter.mjs';
import { createRegionContribution } from './model-contributions.mjs';
import { createModelPropertyCommand } from './model-properties.mjs';
import { sameOutputRef } from '../relief/appearance.mjs';
import {
  createModelRegionDeletionCommand,
  createModelReliefRebindCommand,
} from './model-construction.mjs';

/** Advanced relief edits target evaluated regions, never a mutated legacy Model.
 * Only explicitly changed fields become overrides; object defaults remain live.
 */
export function createModelIntent(action, args, displayed) {
  const request = structuredClone(args);
  const view = structuredClone(displayed);
  if (
    !view ||
    typeof view.epoch !== 'string' ||
    !Number.isInteger(view.revision) ||
    view.previewId !== null
  )
    throw Error('高级建模命令需要已提交版本的区域视图');
  if (action === 'feature') {
    if (
      !request ||
      typeof request.id !== 'string' ||
      !request.changes ||
      typeof request.changes !== 'object' ||
      Array.isArray(request.changes)
    )
      throw Error('请指定体块和属性变更');
    const { name, color, partId, regionId, ...reliefChanges } = request.changes;
    const commands = [];
    if (name !== undefined)
      commands.push(
        createModelIntent(
          'rename-relief',
          { regionId: request.id, name },
          view,
        ),
      );
    if (color !== undefined)
      commands.push(
        createModelIntent('color', { regionId: request.id, color }, view),
      );
    if (partId !== undefined)
      commands.push(
        createModelIntent(
          'assign-part',
          { regionIds: [request.id], partId },
          view,
        ),
      );
    const relief = compileModelFeatureChange(view, request.id, reliefChanges);
    if (Object.keys(relief.changes).length)
      commands.push(createModelIntent('relief', relief, view));
    if (regionId !== undefined && regionId !== request.id) {
      const from = view.regions.find((region) => region.id === request.id);
      const to = view.regions.find((region) => region.id === regionId);
      if (!from || !to) throw Error('体块或新来源区域已失效');
      commands.push(
        createModelReliefRebindCommand(from.outputRef, to.outputRef),
      );
    }
    return (document, context) => {
      if (context.epoch !== view.epoch || context.revision !== view.revision)
        throw Error('高级建模视图已失效，请重新求值');
      const changedRefs = [];
      let selectionIntent;
      for (const command of commands) {
        const result = command(document, context);
        document = result.document;
        changedRefs.push(...result.changedRefs);
        if (result.selectionIntent) selectionIntent = result.selectionIntent;
      }
      return {
        document,
        changedRefs,
        ...(selectionIntent ? { selectionIntent } : {}),
      };
    };
  }
  if (action === 'delete-regions') {
    if (
      !request ||
      !Array.isArray(request.regionIds) ||
      !request.regionIds.length ||
      Object.keys(request).some(
        (key) => !['regionIds', 'reliefIds'].includes(key),
      )
    )
      throw Error('请指定要删除的区域');
    const targets = [...new Set(request.regionIds)].map((id) => {
      const region = view.regions.find((item) => item.id === id);
      if (!region) throw Error('待删除区域已失效');
      return region.outputRef;
    });
    const deleteRelief = request.reliefIds?.length
      ? createModelIntent(
          'delete-relief',
          { regionIds: request.reliefIds },
          view,
        )
      : null;
    return (document, context) => {
      if (context.epoch !== view.epoch || context.revision !== view.revision)
        throw Error('高级建模视图已失效，请重新求值');
      if (deleteRelief) document = deleteRelief(document, context).document;
      const changedRefs = [];
      for (const refs of Object.values(
        Object.groupBy(targets, (ref) => ref.ownerNodeId),
      )) {
        const result = createModelRegionDeletionCommand(refs, {
          discardAssignments: true,
        })(document, context);
        document = result.document;
        changedRefs.push(...result.changedRefs);
      }
      return { document, changedRefs };
    };
  }
  if (action === 'delete-relief' || action === 'rename-relief') {
    if (
      !request ||
      (action === 'rename-relief' &&
        (typeof request.name !== 'string' || !request.name.trim()))
    )
      throw Error('体块名称不能为空');
    const ids =
      action === 'rename-relief' ? [request.regionId] : request.regionIds;
    if (!Array.isArray(ids) || !ids.length) throw Error('请指定体块');
    const targets = [...new Set(ids)].map((id) => {
      const region = view.regions.find((item) => item.id === id);
      if (!region || !region.reliefDefined) throw Error('体块已失效');
      return region.outputRef;
    });
    return (document, context) => {
      if (context.epoch !== view.epoch || context.revision !== view.revision)
        throw Error('高级建模视图已失效，请重新求值');
      for (const target of targets) {
        document = createAuthoringCommand({
          kind: 'set-relief',
          target,
          value: action === 'delete-relief' ? { enabled: false } : {},
        })(document, context).document;
        const assignment = Object.values(
          document.reliefDefinitions.overrides,
        ).find((item) => sameOutputRef(item.target, target));
        if (action === 'delete-relief') assignment.suppressed = true;
        else assignment.name = request.name.trim();
      }
      return { document, changedRefs: targets };
    };
  }
  if (action === 'property')
    return createModelPropertyCommand(request.action, request.args, view);
  if (action === 'color') {
    if (
      !request ||
      Object.keys(request).some(
        (key) => !['regionId', 'color'].includes(key),
      ) ||
      typeof request.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(request.color)
    )
      throw Error('区域颜色必须为六位十六进制色值');
    return (document, context) => {
      if (context.epoch !== view.epoch || context.revision !== view.revision)
        throw Error('高级建模视图已失效，请重新求值');
      let swatchId = Object.values(document.appearances.swatches).find(
        (swatch) => swatch.color.toLowerCase() === request.color.toLowerCase(),
      )?.id;
      if (!swatchId) {
        swatchId = context.idFactory();
        document = createAuthoringCommand({
          kind: 'create-swatch',
          name: request.color,
          color: request.color,
        })(document, { ...context, idFactory: () => swatchId }).document;
      }
      return createModelPropertyCommand(
        'set-region-swatch',
        { regionId: request.regionId, swatchId },
        view,
      )(document, context);
    };
  }
  if (action === 'create-relief') {
    if (
      !request ||
      !Array.isArray(request.regionIds) ||
      !request.regionIds.length ||
      Object.keys(request).some(
        (key) =>
          ![
            'regionIds',
            'partId',
            'mode',
            'heightMM',
            'heightLayers',
            'zMM',
            'attachId',
          ].includes(key),
      )
    )
      throw Error('请指定来源面和体块属性');
    const ids = [...new Set(request.regionIds)];
    const plans = ids.map((id) => {
      const region = view.regions.find((item) => item.id === id);
      if (!region) throw Error('面不存在');
      if (request.heightLayers !== undefined && request.heightMM !== undefined)
        throw Error('厚度只能指定 mm 或打印层数');
      const changes = { enabled: true, mode: request.mode || 'add' };
      if (request.heightLayers !== undefined)
        changes.heightLayers = request.heightLayers;
      else changes.heightMM = request.heightMM ?? 2;
      if (request.zMM !== undefined) changes.zMM = request.zMM;
      if (request.attachId !== undefined) changes.attachId = request.attachId;
      return {
        region,
        patch: compileModelFeatureChange(view, id, changes).changes,
      };
    });
    return (document, context) => {
      if (context.epoch !== view.epoch || context.revision !== view.revision)
        throw Error('高级建模视图已失效，请重新求值');
      const changedRefs = [];
      for (const { region, patch } of plans) {
        let target = region.outputRef;
        if (region.reliefDefined || region.authoredRelief.value.enabled) {
          const result = createRegionContribution(
            document,
            target,
            { ...region.authoredRelief.value, ...patch },
            request,
            context,
          );
          document = result.document;
          target = result.target;
        } else {
          document = createAuthoringCommand({
            kind: 'set-relief',
            target,
            value: patch,
          })(document, context).document;
          if (request.partId !== undefined)
            document = createAuthoringCommand({
              kind: 'set-manufacturing-part',
              target,
              partId: request.partId,
            })(document, context).document;
        }
        changedRefs.push(target);
      }
      return {
        document,
        changedRefs,
        selectionIntent: { scope: 'regions', entityRefs: changedRefs },
      };
    };
  }
  if (action === 'part') {
    if (
      !request ||
      !['create-part', 'rename-part'].includes(request.kind) ||
      Object.keys(request).some(
        (key) => !['kind', 'id', 'name'].includes(key),
      ) ||
      typeof request.id !== 'string' ||
      !request.id ||
      typeof request.name !== 'string' ||
      !request.name.trim()
    )
      throw Error('请指定零件 ID 和名称');
    return (document, context) => {
      if (context.epoch !== view.epoch || context.revision !== view.revision)
        throw Error('高级建模视图已失效，请重新求值');
      return createAuthoringCommand(request)(document, {
        ...context,
        ...(request.kind === 'create-part'
          ? { idFactory: () => request.id }
          : {}),
      });
    };
  }
  if (action === 'assign-part') {
    if (
      !request ||
      Object.keys(request).some(
        (key) => !['regionIds', 'partId'].includes(key),
      ) ||
      !Array.isArray(request.regionIds) ||
      !request.regionIds.length ||
      typeof request.partId !== 'string'
    )
      throw Error('请指定区域和零件');
    const targets = [...new Set(request.regionIds)].map((id) => {
      const region = view.regions.find((item) => item.id === id);
      if (!region) throw Error('区域选区已失效');
      return region.outputRef;
    });
    return (document, context) => {
      if (context.epoch !== view.epoch || context.revision !== view.revision)
        throw Error('高级建模视图已失效，请重新求值');
      const changedRefs = [];
      for (const target of targets) {
        const result = createAuthoringCommand({
          kind: 'set-manufacturing-part',
          target,
          partId: request.partId,
        })(document, context);
        document = result.document;
        changedRefs.push(...result.changedRefs);
      }
      return { document, changedRefs };
    };
  }
  if (action !== 'relief') throw Error(`高级建模动作尚未适配：${action}`);
  if (
    !request ||
    Object.keys(request).some(
      (key) => !['regionIds', 'changes'].includes(key),
    ) ||
    !Array.isArray(request.regionIds) ||
    !request.regionIds.length ||
    request.regionIds.some((id) => typeof id !== 'string') ||
    !request.changes ||
    typeof request.changes !== 'object' ||
    Array.isArray(request.changes) ||
    !Object.keys(request.changes).length ||
    Object.keys(request.changes).some(
      (key) => !['enabled', 'thickness', 'mode', 'placement'].includes(key),
    )
  )
    throw Error('请指定区域和明确的体块属性变更');
  const regions = new Map(view.regions.map((region) => [region.id, region]));
  if (regions.size !== view.regions.length) throw Error('区域视图身份冲突');
  const targets = [...new Set(request.regionIds)].map((id) => {
    const region = regions.get(id);
    if (
      !region ||
      region.outputRef?.kind !== 'output' ||
      region.outputRef.ownerNodeId !== region.objectId
    )
      throw Error('区域选区已失效');
    return region.outputRef;
  });
  return (initialDocument, context) => {
    if (context.epoch !== view.epoch || context.revision !== view.revision)
      throw Error('高级建模视图已失效，请重新求值');
    if (request.changes.thickness !== undefined)
      resolveThicknessMM(
        request.changes.thickness,
        initialDocument.manufacturing.layerHeightMM,
      );
    let document = initialDocument;
    const changedRefs = [];
    for (const target of targets) {
      const result = createAuthoringCommand({
        kind: 'set-relief',
        target,
        value: request.changes,
      })(document, context);
      document = result.document;
      changedRefs.push(...result.changedRefs);
    }
    return { document, changedRefs };
  };
}
