/**
 * 把摄像头归一化坐标映射到全屏，保持 4:3 摄像头画面的原始比例。
 * 大屏虚拟手和能量球共用这一投影，确保两者始终贴合。
 */

export const SOURCE_ASPECT = 4 / 3;

export function projectNormalizedPoint(point, width, height) {
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const scale = Math.max(width / 4, height / 3);
  const contentWidth = 4 * scale;
  const contentHeight = 3 * scale;
  const offsetX = (width - contentWidth) * 0.5;
  const offsetY = (height - contentHeight) * 0.5;
  return [offsetX + point[0] * contentWidth, offsetY + point[1] * contentHeight];
}

export function projectNormalizedPoints(points, width, height) {
  if (!Array.isArray(points) || points.length < 21) return [];
  return points.map((point) => projectNormalizedPoint(point, width, height));
}
