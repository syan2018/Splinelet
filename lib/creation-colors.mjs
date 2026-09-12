export function swatchOwners(creation, id) {
  return creation.objects.filter(
    (o) =>
      o.swatchId === id ||
      Object.values(o.featureSwatches).includes(id) ||
      o.paints.some((p) => p.swatchId === id) ||
      (o.modifiers || []).some((m) => m.styles?.some((s) => s.swatchId === id)),
  );
}

export function removeSwatch(project, creation, id, replacementId) {
  if (!creation.swatches.some((s) => s.id === id)) throw Error('颜色已不存在');
  if (creation.swatches.length === 1) throw Error('至少保留一种项目色');
  const owners = swatchOwners(creation, id);
  const replacement = creation.swatches.find(
    (s) => s.id === replacementId && s.id !== id,
  );
  if (owners.length && !replacement)
    throw Error('该颜色仍在使用，请选择替换颜色');
  if (replacementId !== undefined && !replacement) throw Error('替换颜色无效');
  for (const o of owners) {
    if (o.swatchId === id) {
      o.swatchId = replacement.id;
      // Flat legacy regions do not have featureSwatches; their displayed colour
      // is stored in the recipe as well as using the owner's palette entry.
      for (const region of project.model.regions)
        if (
          o.regionIds?.includes(region.id) &&
          !project.model.features.some((f) => f.regionId === region.id)
        )
          region.color = replacement.color;
    }
    for (const paint of o.paints)
      if (paint.swatchId === id) paint.swatchId = replacement.id;
    for (const modifier of o.modifiers || [])
      for (const style of modifier.styles || [])
        if (style.swatchId === id) style.swatchId = replacement.id;
    for (const [featureId, swatchId] of Object.entries(o.featureSwatches)) {
      if (swatchId !== id) continue;
      o.featureSwatches[featureId] = replacement.id;
      const feature = project.model.features.find((f) => f.id === featureId);
      if (feature) feature.color = replacement.color;
    }
  }
  creation.swatches = creation.swatches.filter((s) => s.id !== id);
}
