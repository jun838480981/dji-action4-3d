# DJI Osmo Action 4 · 三维拆解页面「渲染质量 + 性能」审计报告

- 生成时间：2026-10-27T05:53:45.916Z（本地 Tue Oct 27 2026 13:55:36 GMT+0800 (中国标准时间)）
- 审计脚本：`qa/perf/render-audit.mjs`（可重复运行）
- 运行命令：`node qa/perf/render-audit.mjs --baseline --uncapped`
- 原始数据：`qa/perf/results.json`
- 截图目录：`qa/perf/shots/baseline/`（基线）与 `qa/perf/shots/current/`（当前）
- 基线：git `9edadf1`（feat: DJI Osmo Action 4 3D teardown visualization），通过 `git worktree add` 检出到系统临时目录，审计后已清理
- current（工作区）：git `9edadf1`，**含未提交改动**（产品文件：README.md、js/app.js、js/lib/model.js、js/lib/textures.js；另有 40 处非产品文件改动）；两版产品文件 SHA-256 见 `results.json` 的 `baseline.files` / `current.files`

## 1. 运行环境

| 项目 | 值 |
| --- | --- |
| Chrome | 155.0.8059.85（C:/Program Files/Google/Chrome/Application/chrome.exe） |
| Playwright-core | 1.64.1（F:/LearnSpace/前端与Web/dsh大肥鱼/qq-bot/node_modules/playwright-core） |
| Node.js | v20.20.0 |
| 操作系统 | win32 x64 · 10.0.22631 |
| CPU / 内存 | 13th Gen Intel(R) Core(TM) i5-13400F × 16 核 / 34.2 GB |
| GPU（WebGL 报告） | ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00002188) Direct3D11 vs_5_0 ps_5_0, D3D11) |

## 2. 方法与口径

- **A/B 口径**：同一脚本、同一台机器、同一 Chrome 进程内连续运行；基线使用 `git worktree add <系统临时目录> <ref>` 检出为独立目录，审计结束即删除，不触碰工作区。
- **截图与性能**：视口 1600×1000；分别建立 `deviceScaleFactor=1`（DPR1）与 `deviceScaleFactor=2`（DPR2）两个浏览器上下文；性能采样均为 3 秒 `requestAnimationFrame` 采样。
- **页面就绪判据**：`window.DJI_APP && window.DJI_APP.state.ready === true`；每次采样前等待相机机位稳定。
- **抗锯齿客观指标**：对「仅 canvas、隐藏全部 DOM 覆盖层」的纯 3D 截图计算（每档 3 帧取中位数，括号内为 3 帧极差的一半，作为采样噪声参考）：
  - `edgeTransitionRatio`（口径 1，任务指定）：亮度分三档——暗 `L < 8`、中间 `L ∈ [8, 70]`、亮 `L > 70`；统计"自身落在中间档、且 3x3 邻域同时存在暗与亮像素"的像素占全图比例。
  - `edgeTransitionPerEdge`：上述过渡像素 / 强对比边缘候选像素（3×3 邻域亮度极差 > 62），削弱内容占比差异。
  - `edgeTransitionRatioLocal` / `edgeTransitionPerEdgeLocal`（口径 2，补充）：局部对比口径，不依赖绝对亮度——像素位于 3×3 邻域 min/max 之间且与两端各保留 15% 极差的余量；对 tone mapping/曝光调整更稳健。
  - `hfEnergy`：内部像素水平、垂直二阶差分平方的均值（越大表示高频/锯齿能量越强）；`hfEnergyPerEdge` 为仅在边缘候选像素上的同类统计。
- **判读方向与因果**：抗锯齿会把 1px 的硬边"摊平"成 2~3px 的中间亮度过渡，因此**过渡像素比例/每边缘过渡像素越高 = 边缘过渡越平滑（AA 越好）**、`hfEnergy` 越低 = 边缘高频能量越弱（锯齿越少）。注意它并不等价于"越模糊越好"：分辨率被降低再放大等过度模糊同样会抬升该比例，所以报告中同时给出 `hfEnergy`、per-edge 归一化指标和 2.6× 像素放大截图做交叉验证；本审计在固定机位、相同场景内容下前后对比，AA 指标差异主要来自抗锯齿实现（若版本间同时调整了色调映射/曝光，全局亮度三档口径会被影响，报告会额外标注并以不依赖绝对亮度的局部对比口径为准）。DPR2 因设备像素超采样，AA 差异会被大幅掩盖，**在 DPR1 下抗锯齿差异最明显**。
- **画质档位对齐**：新版页面带自适应画质（`setQuality/getQuality`）。为避免"自适应降档"混入 before/after 差异，AA 截图与性能采样前会调用 `setQuality("high")` 固定为 high 档（high 是该页面用户可主动取到的最高档位；基线版本无此 API，始终为默认最高配置）；未干预的初始自动档位单独记录在第 3.1 节。
- **采样注意**：性能采样期间若与其他截图/重负载任务并行，fps 会被压低；脚本在 fps 低于 57 时会自动重测一次并取较好结果，并在报告中标注。场景含缓慢动画（模型浮动、背景呼吸），AA 指标为统计量，报告给出 3 帧离散度。

## 3. 渲染能力与画质参数（before / after）

| 指标 | baseline | current |
| --- | --- | --- |
| WebGL 版本 | WebGL 2.0 (OpenGL ES 3.0 Chromium) | WebGL 2.0 (OpenGL ES 3.0 Chromium) |
| GPU（unmasked） | ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00002188) Direct3D11 vs_5_0 ps_5_0, D3D11) | ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00002188) Direct3D11 vs_5_0 ps_5_0, D3D11) |
| maxSamples（WebGL2 上限） | 8 | 8 |
| 默认帧缓冲 samples（MSAA） | 4 | 0 |
| maxAnisotropy | 16 | 16 |
| 初始默认画质档位（DPR1，未干预） | — | high |
| 初始默认画质档位（DPR2，未干预） | — | medium |
| AA/性能测量档位（脚本固定） | 不适用（无 setQuality，默认最高） | high（setQuality 固定） |
| DPR1 上下文 pixelRatio | 1 | 1 |
| DPR1 drawingBuffer 尺寸 | 1600 × 1000 | 1600 × 1000 |
| DPR2 上下文 pixelRatio（默认） | 2 | 1.5 |
| DPR2 上下文 drawingBuffer（默认） | 3200 × 2000 | 2400 × 1500 |
| DPR2 上下文 pixelRatio（测量时） | 2 | 2 |
| DPR2 上下文 drawingBuffer（测量时） | 3200 × 2000 | 3200 × 2000 |
| canvas CSS 尺寸 | 1600 × 1000 | 1600 × 1000 |
| context.antialias | 是 | 否 |
| getStats 可用 | 否 | 是 |
| setQuality 可用 | 否 | 是 |
| 测量时画质档位（getQuality / state.qualityTier） | — | high |
| 后处理 MSAA samples（composer，DPR1） | — | 4 |
| 后处理 MSAA samples（composer，DPR2） | — | 4 |
| 后处理 render target 尺寸（DPR1） | — | 1600 × 1000 |
| 后处理 pass 数 | — | 4 |
| stats.tier / 画质档位 | — | high |
| stats.samples（MSAA 采样数） | — | 4 |
| stats.shadow（阴影） | — | 是 |
| stats.shadowMap | — | 2048 |
| stats.bloom | — | 是 |
| stats.dpr | — | 1 |
| stats.frameTimeAvg | — | 16.662967409214154 |
| stats.drawCalls / 绘制调用 | — | 612 |
| stats.triangles / 三角面 | — | 270339 |
| stats.programs / textures / geometries | — | 31 / 35 / 319 |
| renderer.info.calls（仅最后一次 pass，参考性有限） | 1 | 612 |
| renderer.info.triangles（仅最后一次 pass，参考性有限） | 1 | 270339 |

> 关键差异：baseline 的 4× MSAA 只落在默认帧缓冲（场景先渲染到不带 MSAA 的后处理 render target，最终合成时实际拿不到边缘 MSAA）；current 关闭默认 `antialias`，改为在 composer render target 上启用 MSAA（samples=4）。这是 AA 指标大幅改善的直接原因之一。

### 3.1 画质档位：初始自动档位 vs 审计固定 high 档位

| 上下文 | baseline | current 初始自动档位（未干预） | current 测量档位（脚本强制） | 说明 |
| --- | --- | --- | --- | --- |
| DPR1（1600×1000） | 默认配置（无画质档位 API） | high | high | high 为该页面用户可主动取到的最高档位（setQuality("high")） |
| DPR2（1600×1000 @2×） | 默认配置（无画质档位 API） | medium | high | 初始自动档位由产品自适应策略决定；DPR2 启动时可能按启发式先降一档 |

> 本次运行自适应降档标记：baseline `未触发`；current `未触发`（qualityDowngraded/qualityDropped）。


## 4. 性能（3 秒 rAF 采样 @ 1600×1000）

### 4.1 DPR1 上下文

| DPR1 指标 | baseline | current | Δ(current vs baseline) |
| --- | --- | --- | --- |
| fps（越高越好） | 60.00 | 60.00 | 0.0% |
| 帧数 / 采样时长 | 181 帧 | 181 帧 |  |
| frame-time p50 | 16.70 ms | 16.70 ms | 0.0% |
| frame-time p95 | 16.80 ms | 16.80 ms | 0.0% |
| >33.4ms 掉帧数 | 0 | 0 |  |
| jsHeap（采样后 used / total） | 23.4 / 37.8 MB | 24.8 / 54.2 MB |  |
| 画质档位 / 自动降档（采样后） | dropped=false | tier=2 / downgraded=false |  |

### 4.2 DPR2 上下文

| DPR2 指标 | baseline | current | Δ(current vs baseline) |
| --- | --- | --- | --- |
| fps（越高越好） | 60.00 | 60.00 | 0.0% |
| 帧数 / 采样时长 | 181 帧 | 181 帧 |  |
| frame-time p50 | 16.70 ms | 16.70 ms | 0.0% |
| frame-time p95 | 16.80 ms | 16.80 ms | 0.0% |
| >33.4ms 掉帧数 | 0 | 0 |  |
| jsHeap（采样后 used / total） | 20.7 / 35.6 MB | 26.3 / 54.2 MB |  |
| 画质档位 / 自动降档（采样后） | dropped=false | tier=2 / downgraded=false |  |

### 4.3 补充：不限帧率模式（--disable-frame-rate-limit，仅 DPR1，作为渲染开销信号）

| 指标 | baseline | current | Δ |
| --- | --- | --- | --- |
| DPR1 fps（不限帧率） | 282.25 | 112.84 | -60.0% |
| DPR1 frame-time p50（不限帧率） | 3.30 ms | 8.00 ms |  |

> 说明：垂直同步下当前机器两个版本都被锁在 60fps，默认分辨率看不到性能差异；「不限帧率」fps 用于观察渲染管线开销的变化（越低表示每帧 GPU 开销越大）。该模式噪声大于垂直同步模式，仅作趋势参考。

## 5. 抗锯齿客观指标（仅 canvas 纯 3D，固定机位）

> 采样说明：每个 DPR 连续取 3 帧，表中为中位数，副行括号内为 3 帧极差的一半（噪声参考）。**在 DPR1 下抗锯齿差异最明显**；DPR2 因超采样差异被掩盖。

### 5.1 DPR1（1×，AA 差异最明显）

| DPR1 指标 | baseline | current | Δ |
| --- | --- | --- | --- |
| edgeTransitionRatio（全局三档，任务口径） | 0.3306% <br><sub>±0.0028%</sub> | 0.4753% <br><sub>±0.0205%</sub> | +43.8% |
| edgeTransitionPerEdge（全局三档 / 边缘） | 8.3939% <br><sub>±0.0311%</sub> | 11.2918% <br><sub>±0.2142%</sub> | +34.5% |
| edgeTransitionRatioLocal（局部对比，补充） | 2.5293% <br><sub>±0.0054%</sub> | 3.7728% <br><sub>±0.0267%</sub> | +49.2% |
| edgeTransitionPerEdgeLocal（局部对比 / 边缘） | 27.7570% <br><sub>±0.2339%</sub> | 37.7318% <br><sub>±0.0419%</sub> | +35.9% |
| edgeCandidateRatio | 3.9401% <br><sub>±0.0191%</sub> | 4.1314% <br><sub>±0.2245%</sub> |  |
| hfEnergy（二阶差分能量，越低越平滑） | 503.268 <br><sub>±6.058</sub> | 335.375 <br><sub>±8.264</sub> | -33.4% |
| hfEnergyPerEdge（边缘上的高频能量） | 5403.251 <br><sub>±32.788</sub> | 3263.802 <br><sub>±59.493</sub> | -39.6% |
| meanLuma / 亮部像素占比 | 13.38 / 3.53% | 22.93 / 9.19% |  |

### 5.2 DPR2（2×，超采样掩盖 AA 差异）

| DPR2 指标 | baseline | current | Δ |
| --- | --- | --- | --- |
| edgeTransitionRatio（全局三档，任务口径） | 0.1327% <br><sub>±0.0028%</sub> | 0.2105% <br><sub>±0.0031%</sub> | +58.6% |
| edgeTransitionPerEdge（全局三档 / 边缘） | 5.8546% <br><sub>±0.1133%</sub> | 8.7372% <br><sub>±0.2508%</sub> | +49.2% |
| edgeTransitionRatioLocal（局部对比，补充） | 1.8040% <br><sub>±0.0034%</sub> | 2.5865% <br><sub>±0.0034%</sub> | +43.4% |
| edgeTransitionPerEdgeLocal（局部对比 / 边缘） | 32.1926% <br><sub>±0.0712%</sub> | 41.4012% <br><sub>±0.0201%</sub> | +28.6% |
| edgeCandidateRatio | 2.2666% <br><sub>±0.0033%</sub> | 2.4094% <br><sub>±0.1076%</sub> |  |
| hfEnergy（二阶差分能量，越低越平滑） | 279.353 <br><sub>±1.294</sub> | 189.733 <br><sub>±2.354</sub> | -32.1% |
| hfEnergyPerEdge（边缘上的高频能量） | 4897.003 <br><sub>±20.221</sub> | 2925.176 <br><sub>±32.209</sub> | -40.3% |
| meanLuma / 亮部像素占比 | 13.74 / 3.67% | 22.85 / 9.09% |  |

## 6. 截图清单

| 文件 | 场景 | baseline | current |
| --- | --- | --- | --- |
| 01-assembled-1600x1000.png | 组装态全景（1600×1000，含 UI） | [01-assembled-1600x1000.png](shots/baseline/01-assembled-1600x1000.png) | [01-assembled-1600x1000.png](shots/current/01-assembled-1600x1000.png) |
| 02-exploded-1600x1000.png | 爆炸拆解态（1600×1000，含 UI） | [02-exploded-1600x1000.png](shots/baseline/02-exploded-1600x1000.png) | [02-exploded-1600x1000.png](shots/current/02-exploded-1600x1000.png) |
| 03-lens-closeup.png | 镜头特写（选中 lens 后产品自动定位机位；不可用时退化） | [03-lens-closeup.png](shots/baseline/03-lens-closeup.png) | [03-lens-closeup.png](shots/current/03-lens-closeup.png) |
| 04-zoom-2.6x-pixelated.png | 2.6× 像素放大（canvas scale(2.6) + image-rendering:pixelated，DOM 覆盖层隐藏） | [04-zoom-2.6x-pixelated.png](shots/baseline/04-zoom-2.6x-pixelated.png) | [04-zoom-2.6x-pixelated.png](shots/current/04-zoom-2.6x-pixelated.png) |
| 05-canvas-clean-dpr1.png | 仅 canvas 纯 3D（隐藏 DOM 覆盖层），DPR1，固定机位，AA 指标基图 | [05-canvas-clean-dpr1.png](shots/baseline/05-canvas-clean-dpr1.png) | [05-canvas-clean-dpr1.png](shots/current/05-canvas-clean-dpr1.png) |
| 06-canvas-clean-dpr2.png | 仅 canvas 纯 3D（隐藏 DOM 覆盖层），DPR2，固定机位，AA 指标基图 | [06-canvas-clean-dpr2.png](shots/baseline/06-canvas-clean-dpr2.png) | [06-canvas-clean-dpr2.png](shots/current/06-canvas-clean-dpr2.png) |
| 07-mobile-390x844.png | 移动端 390×844（DPR2，含 UI） | [07-mobile-390x844.png](shots/baseline/07-mobile-390x844.png) | [07-mobile-390x844.png](shots/current/07-mobile-390x844.png) |

> 截图口径：`01`-`03` 含页面 UI；`04` 为 canvas `scale(2.6)` + `image-rendering:pixelated` 且隐藏 DOM 覆盖层；`05`/`06` 为仅 canvas 纯 3D（隐藏 DOM 覆盖层，用于 AA 指标）；`07` 为移动端 390×844（DPR2）。

## 7. 发现的问题 / 异常

### 7.1 日志汇总（console warning 也纳入统计）

| 版本 | console.error | console.warning | pageerror | 请求失败/HTTP≥400 |
| --- | --- | --- | --- | --- |
| baseline | 0 | 0 | 0 | 0 |
| current | 0 | 0 | 0 | 0 |

> ✅ 两个版本均无 console.error / console.warning / pageerror / 资源加载失败；未发现 three.js 关于 MSAA、shadow map 或半浮点 render target 的警告。

### 7.2 异常与风险

- ℹ️ [baseline] 页面未暴露 `DJI_APP.getStats()`，能力表相关字段为「—」（基线版本符合预期）
- ℹ️ [baseline] 页面未暴露 `DJI_APP.setQuality()`（基线版本符合预期）

## 8. 结论

### 8.1 抗锯齿 / 画质

- **DPR1（1×，差异最明显）**：edgeTransitionPerEdge 8.39% → 11.29%（Δ +34.5%✅ 更平滑）；hfEnergy 503.27 → 335.38（Δ -33.4%✅ 更平滑）；edgeTransitionPerEdgeLocal 27.76% → 37.73%（Δ +35.9%✅ 更平滑）。
- **DPR2（2×，超采样掩盖差异）**：edgeTransitionPerEdge 5.85% → 8.74%（Δ +49.2%✅ 更平滑）；hfEnergy 279.35 → 189.73（Δ -32.1%✅ 更平滑）；edgeTransitionPerEdgeLocal 32.19% → 41.40%（Δ +28.6%✅ 更平滑）。

> 说明：**在 DPR1 下抗锯齿差异最明显**——1× 设备像素没有任何超采样兜底，边缘过渡像素的变化最直接；DPR2 因 2× 设备像素本身更平滑，人眼可感知的锯齿差异被部分掩盖（统计指标同样显著改善）。
> ⚠️ 交叉校验：两版纯 canvas 画面整体亮度变化明显（DPR1 meanLuma 13.38 → 22.93，+71.4%；亮部像素占比 3.53% → 9.19%），说明 current 同时包含色调映射/曝光类变化。全局亮度三档口径（edgeTransitionRatio / edgeTransitionPerEdge）对亮度分布敏感，**AA 结论以不依赖绝对亮度的局部对比口径（edgeTransitionPerEdgeLocal）与 hfEnergy 为准**——两者方向一致且幅度远超 3 帧噪声，2.6× 像素放大截图亦可佐证。


### 8.2 性能

- DPR1：fps 60.00 → 60.00（0.0%）；frame-time p95 16.80ms → 16.80ms（0.0%）。两者均稳定在 60fps 垂直同步上限，该分辨率下的性能差异不可测（需看 --uncapped 补充）。
- DPR2：fps 60.00 → 60.00（0.0%）；frame-time p95 16.80ms → 16.80ms（0.0%）。两者均稳定在 60fps 垂直同步上限，DPR2 下当前版本仍有余量。
- 不限帧率补充（DPR1）：282.3 → 112.8 fps（-60.0%）。
- 解读：当前版本每帧渲染开销约为基线的 2.50×（平均帧时间 3.54ms → 8.86ms）。在 GTX 1650 / 1600×1000 下仍能锁住 60fps，但低端集显或更高 DPR 场景会更依赖自适应降档；画质提升与这一开销是同一枚硬币的两面。

### 8.3 风险与建议

- ℹ️ current 的 AA 与性能均在 `setQuality("high")` 固定档位下测量（防止自适应降档污染对比）；未干预的初始档位见第 3.1 节。
- ℹ️ 初始自动档位观察：DPR2 初始自动档位为 `medium`（启动启发式先降一档），强制 high（2× + MSAA）后仍为 60.0fps。即性能充裕的机器默认拿到的是"保守档"，用户需手动切换到 high 才能获得页面提供的上限画质；本次运行未观察到运行期 qualityDowngraded 触发。
- 采样离散度：DPR1 hfEnergy 3 帧极差最大 16.53；DPR2 hfEnergy 3 帧极差最大 4.71。场景含缓慢动画，AA 指标为统计量，建议以「变化幅度 vs 噪声」判断显著性。

## 9. 复现方式

```bash
# 只审计当前工作区（当前版本）
node qa/perf/render-audit.mjs

# 审计当前工作区 + HEAD 基线（git ref 默认 9edadf1），生成 A/B 对比报告
node qa/perf/render-audit.mjs --baseline

# 自测：只跑基线；或指定基线 ref / 输出目录 / 额外不限帧率性能采样
node qa/perf/render-audit.mjs --baseline-only --ref 9edadf1 --out qa/perf
node qa/perf/render-audit.mjs --baseline --uncapped
```

前置条件：

- Chrome：`C:/Program Files/Google/Chrome/Application/chrome.exe`（可通过环境变量 `QA_CHROME` 覆盖，需真实 GPU；headless 启动参数含 `--ignore-gpu-blocklist --use-angle=default`）
- playwright-core：`F:/LearnSpace/前端与Web/dsh大肥鱼/qq-bot/node_modules/playwright-core`（可通过 `QA_PLAYWRIGHT` 覆盖）
- 本机 Node.js ≥ 18（脚本使用 ESM 与 `node:zlib`，无第三方依赖）
- **性能采样时请勿并行执行其他截图/重负载任务**，否则 fps 会被压低（脚本检测到会重测一次并标注）
