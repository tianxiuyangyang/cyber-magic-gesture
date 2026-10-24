/**
 * MediaPipe HandLandmarker 结果 → 内部 Hand 结构。
 *
 * 注意字段名：JS 版 Tasks Vision 返回的是 `landmarks` / `handednesses`
 * （Python 版才是 `hand_landmarks` / `handedness`）。这里同时兼容两套写法，
 * 避免因为读错字段而出现“摄像头正常但永远检测不到手”的假黑屏。
 *
 * 纯逻辑，不依赖 DOM，可在 Node 里测试。
 */

export function mapLandmarkerResult(result) {
  const landmarks = result?.landmarks || result?.handLandmarks || [];
  const handedness = result?.handednesses || result?.handedness || [];

  return landmarks.map((points, index) => {
    const category = handedness[index]?.[0];
    const depths = points.map((point) => Number(point.z) || 0);
    return {
      points: points.map((point) => [Number(point.x), Number(point.y)]),
      depths,
      z: depths.reduce((sum, value) => sum + value, 0) / Math.max(1, depths.length),
      label: category?.categoryName || 'Unknown',
      score: Number(category?.score) || 0,
    };
  });
}

