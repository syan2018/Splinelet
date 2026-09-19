export function geometryContours(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return (geometry.geometries || []).flatMap(geometryContours);
}
export function regionSVGPath(geometry, project) {
  const scale = project.width / project.widthMM;
  return geometryContours(geometry)
    .map(
      (r) =>
        'M ' +
        r
          .map(
            ([x, y]) =>
              `${+(project.width / 2 + x * scale).toFixed(5)} ${+(project.height / 2 - y * scale).toFixed(5)}`,
          )
          .join(' L ') +
        ' Z',
    )
    .join(' ');
}
