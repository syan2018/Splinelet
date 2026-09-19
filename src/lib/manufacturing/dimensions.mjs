export function resolveThicknessMM(thickness, layerHeightMM) {
  if (!thickness || !Number.isFinite(layerHeightMM) || layerHeightMM <= 0)
    throw Error('厚度或层高无效');
  if (
    thickness.kind === 'mm' &&
    Number.isFinite(thickness.value) &&
    thickness.value > 0
  )
    return { mm: thickness.value, layers: null };
  if (
    thickness.kind === 'layers' &&
    Number.isInteger(thickness.count) &&
    thickness.count > 0
  )
    return { mm: thickness.count * layerHeightMM, layers: thickness.count };
  throw Error('厚度必须是正 mm 或正整数 layers');
}
