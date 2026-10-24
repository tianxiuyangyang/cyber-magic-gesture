# 手部模型

`hand_landmarker.task` 是 MediaPipe 官方的手部关键点模型（float16，约 7.5 MB），
从项目根目录的 `models/hand_landmarker.task` 原样复制过来，供网页版直接加载。

- 官方下载地址：
  `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`
- 与 Python 版使用同一个模型文件，识别结果一致。

## 为什么这里要放一份

网页服务器只把 `web/` 目录作为站点根目录（不暴露 `.venv`、`output` 等目录），
所以模型需要放在 `web/` 里面。它和 `models/` 下的文件是同一份内容。

## 更新模型时

同时替换两处，避免桌面版和网页版识别结果不一致：

```powershell
Copy-Item models\hand_landmarker.task web\assets\hand_landmarker.task -Force
```
