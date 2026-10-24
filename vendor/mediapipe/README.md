# MediaPipe Tasks Vision（内置运行时）

网页版直接使用浏览器里的 MediaPipe Tasks Vision，不依赖任何 CDN 或 npm 安装。

| 项目 | 内容 |
| --- | --- |
| npm 包 | `@mediapipe/tasks-vision` |
| 版本 | **0.10.35**（与 Python 版 `mediapipe==0.10.35` 对齐） |
| 来源 | `https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.35.tgz`（实际经 npmmirror 镜像下载） |
| 许可证 | Apache-2.0，全文见 [LICENSE](LICENSE) |
| 修改 | 无。只从 npm 包中原样复制文件 |

## 文件

```
vision_bundle.mjs                       主模块（ES Module）
wasm/vision_wasm_internal.js            SIMD 版 wasm 加载器
wasm/vision_wasm_internal.wasm          SIMD 版 wasm 本体
wasm/vision_wasm_nosimd_internal.js     不支持 SIMD 时的回退加载器
wasm/vision_wasm_nosimd_internal.wasm   回退 wasm 本体
```

`FilesetResolver.forVisionTasks()` 会按浏览器的 WebAssembly SIMD 支持情况自动挑选
其中一套，所以不需要在代码里判断。

## 升级步骤

1. 从 npm 包中复制新的 `vision_bundle.mjs` 和 `wasm/` 目录到本目录（保持文件名）；
2. 如果新版本改了 API，检查 `js/tracker.js`；
3. 用 `?selftest=1` 在浏览器里跑一次初始化 + 推理自检。

> 运行时只加载本地文件；页面断网也能用。请不要把这里的路径改成 CDN 地址，
> 国内网络访问 jsDelivr / unpkg 经常超时。
