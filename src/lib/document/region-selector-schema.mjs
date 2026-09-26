/** The selector language is deliberately closed. Geometry samples, old output
 * signatures and arbitrary JSON are not admissible authoring conditions. */
export function validateRegionSelector(
  value,
  { exactKeys, id, finite, vec2, validateOutputRef, validateEntityRef, fail },
) {
  const instances = (items) => {
    if (!Array.isArray(items)) fail('selector instances 无效');
    for (const item of items) {
      exactKeys(item, ['operatorId', 'index'], 'selector instance');
      id(item.operatorId);
      if (!Number.isSafeInteger(item.index) || item.index < 0)
        fail('selector instance index 无效');
    }
  };
  const sourceUse = (item) => {
    const base = ['kind', 'operatorId', 'role'];
    if (
      [
        'curve-use',
        'generated-closure',
        'generated-stroke',
        'generated-join',
      ].includes(item?.kind)
    ) {
      exactKeys(
        item,
        [
          ...base,
          'sketchId',
          'pathId',
          'instances',
          ...(item.kind === 'generated-join' ? ['endpoint'] : []),
        ],
        'selector source',
      );
      id(item.sketchId);
      id(item.pathId);
      instances(item.instances);
      if (item.kind === 'generated-join' && !finite(item.endpoint))
        fail('selector endpoint 无效');
    } else if (item?.kind === 'baked-boundary') {
      exactKeys(item, [...base, 'regionId'], 'snapshot boundary', [
        'instances',
      ]);
      id(item.regionId);
      if (item.instances !== undefined) instances(item.instances);
    } else if (item?.kind === 'generated-offset') {
      exactKeys(item, [...base, 'parent'], 'selector offset', ['instances']);
      validateOutputRef(item.parent, 'selector offset parent');
      if (item.instances !== undefined) instances(item.instances);
    } else if (item?.kind === 'generated-between-join') {
      exactKeys(item, [...base, 'ends'], 'selector between join', [
        'instances',
      ]);
      if (item.instances !== undefined) instances(item.instances);
      if (!Array.isArray(item.ends) || item.ends.length !== 2)
        fail('selector join ends 无效');
      for (const end of item.ends) {
        if (!Array.isArray(end)) fail('selector join end 无效');
        for (const endpoint of end) {
          exactKeys(
            endpoint,
            ['path', 'parameter', 'instances'],
            'selector join endpoint',
          );
          exactKeys(
            endpoint.path,
            ['sketchId', 'pathId'],
            'selector join path',
          );
          id(endpoint.path.sketchId);
          id(endpoint.path.pathId);
          instances(endpoint.instances);
          if (!finite(endpoint.parameter)) fail('selector join parameter 无效');
        }
      }
    } else fail('selector source 类型无效');
    id(item.operatorId);
    id(item.role);
  };
  const event = (item) => {
    exactKeys(item, ['kind', 'branches'], 'selector event');
    if (
      item.kind !== 'intersection' ||
      !Array.isArray(item.branches) ||
      item.branches.length < 2 ||
      item.branches.length > 64
    )
      fail('selector intersection 无效');
    for (const branch of item.branches) {
      exactKeys(branch, ['use', 'domain'], 'selector branch');
      sourceUse(branch.use);
      if (branch.domain !== 'all') {
        vec2(branch.domain, 'selector domain');
        if (
          branch.use.kind !== 'curve-use' ||
          branch.domain[0] >= branch.domain[1]
        )
          fail('selector domain 无效');
      }
    }
  };
  const ring = (items) => {
    if (!Array.isArray(items) || !items.length || items.length > 16384)
      fail('selector ring 无效');
    for (const item of items) {
      exactKeys(
        item,
        ['sources', ...(item.closed === true ? ['closed'] : ['start', 'end'])],
        'selector run',
      );
      if (
        !Array.isArray(item.sources) ||
        !item.sources.length ||
        item.sources.length > 64
      )
        fail('selector run sources 无效');
      for (const source of item.sources) {
        exactKeys(source, ['use', 'direction'], 'selector directed source');
        sourceUse(source.use);
        if (![1, -1].includes(source.direction))
          fail('selector source direction 无效');
      }
      if (!item.closed) {
        event(item.start);
        event(item.end);
      } else if (items.length !== 1) fail('selector closed run 必须独占闭环');
    }
  };
  if (value?.kind === 'cell') {
    exactKeys(value, ['kind', 'outer', 'holes'], 'cell selector');
    ring(value.outer);
    if (!Array.isArray(value.holes) || value.holes.length > 16384)
      fail('selector holes 无效');
    value.holes.forEach(ring);
  } else if (value?.kind === 'result') {
    const parentRoles = ['boolean', 'offset', 'reference', 'array'];
    if (parentRoles.includes(value.role)) {
      exactKeys(
        value,
        [
          'kind',
          'role',
          'parent',
          ...(value.role === 'array' ? ['index'] : []),
        ],
        'result selector',
      );
      validateOutputRef(value.parent, 'result parent');
      if (
        value.role === 'array' &&
        (!Number.isSafeInteger(value.index) || value.index < 0)
      )
        fail('result index 无效');
    } else if (value.role === 'snapshot') {
      exactKeys(value, ['kind', 'role', 'id'], 'snapshot result');
      id(value.id);
    } else if (value.role === 'stroke') {
      exactKeys(
        value,
        ['kind', 'role', 'path', 'instances'],
        'stroke selector',
      );
      if (value.path?.kind !== 'path') fail('stroke path 无效');
      validateEntityRef(value.path, 'stroke path');
      instances(value.instances);
    } else {
      exactKeys(value, ['kind', 'role'], 'result selector');
      if (
        !['closed-path', 'between', 'outline', 'selection'].includes(value.role)
      )
        fail('result role 无效');
    }
  } else fail('RegionDefinition.selector 类型无效');
}
