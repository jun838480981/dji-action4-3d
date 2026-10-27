# DJI Osmo Action 4 · 3D 拆解实验室 — 独立验收报告

- 验收对象：`F:\LearnSpace\前端与Web\dji-action4-3d`（纯静态，`file://` 直接打开）
- 验收角色：独立验收员（只读产品代码，只写 `qa/review/`）
- 验收时间：2026-10-27 10:16 – 10:45（Asia/Shanghai）
- 结论：**8 个验收项全部 PASS；无 P0、无 P1；发现 4 个 P2（其中 2 个已由最新代码修复/消除，1 个为测试口径，1 个低影响未修复）**。可交付。

## 0. 验收环境与代码快照

| 项 | 值 |
|---|---|
| 浏览器 | Chrome 155.0.8059.85（Playwright-core headless） |
| 渲染 | WebGL2 · ANGLE (NVIDIA GeForce GTX 1650, Direct3D11)，非 SwiftShader |
| 视口 | 1600×1000、1100×780、390×844（isMobile + touch） |
| 访问方式 | `file:///F:/LearnSpace/前端与Web/dji-action4-3d/index.html` |

被测代码 SHA-256（测试快照 10:33:53；测试期间产品文件被同事更新，最终结论以当前文件为准）：

| 文件 | SHA-256（快照） |
|---|---|
| index.html | `17780a5d…09aaec` |
| css/style.css | `977926c0…75a3f1` |
| js/app.js | `d32d5dd8…20dd1d` |
| js/lib/model.js | `1e122895…6a2937` |
| js/lib/textures.js | `65d80512…d2dd2` |
| js/vendor/three-bundle.min.js | `ff49dd7e…a47946` |

> 说明：验收期间 `model.js`(10:25)、`style.css`(10:27)、`app.js`(10:43) 有更新（Lead 说明为纯视觉/文案与移动端交互收尾）。报告以最新文件为准，并对更新后的两项修复做了源码核验（见 P2-1/P2-3）。

## 1. 总览

自动化检查共 **69 项**（8 个验收项拆解）：

- 首轮稳定结果：**67 PASS / 2 FAIL**；2 个 FAIL 均属 P2 级，不阻塞（详见第 3 节：①HLG 额外声明已移除；②参数文本 token/格式差异，事实值一致）。
- 归一化修正后最终复跑：**68 PASS / 1 FAIL**（仅剩 HLG 一项，原因：该页面实例加载于 10:43 修复前的 app.js；当前源码已无 `HLG`，已核验）。

| # | 验收项 | 结果 | 关键证据 |
|---|---|---|---|
| 1 | 加载 / console / 网络 / 资源 | **PASS** | 18 个请求全部 `file://`，0 外部域名、0 404、0 requestfailed、0 console error、0 pageerror；启动层退场、无 WebGL 失败面板；GPU 为真机 NVIDIA |
| 2 | 14 部件 / 清单 / 标注 / 拆解 / 3D 点选 | **PASS** | 模型·清单·标注均 14，名称/英文名/标注参数逐项一致；14 项清单逐一真实点击均选中且进度 100%、详情与高亮同步；拆解态 14/14 标注可见；点击画布 8/8 命中部件（镜头/前屏/USB-C 盖 3 项精确命中，其余被前层部件遮挡属正常遮挡语义）；悬停提示正常 |
| 3 | 拆解/组装、复位、自动旋转、标注、自动视角、指南、规格 Tab、定位/收起 | **PASS** | 21/21 检查通过；进度 100%↔00%、按钮文案/aria 同步；复位相机误差 0；自动旋转相机实际转动；标注 14→0→14；指南 6 条 + 三种关闭方式；规格 Tab 5 分区 31 行含全部核心参数；「定位所选」相机位移 9.07、「收起详情」回概览 |
| 4 | 键盘 Space / R / L / Esc / ? | **PASS** | body 聚焦下全部生效（Space 拆解/组装、R 复位误差 0.012、L 标注开关、Esc 关弹窗/取消选中、Shift+/ = ? 开指南）；F 全屏在 headless 下也成功进入 |
| 5 | 拖拽 / 滚轮 / 空白取消选中 | **PASS** | 拖拽相机位移 8.69 且不误选中；滚轮距离 13.8→11.06；空白点击取消选中并回整机概览；移动端空白点按同样生效 |
| 6 | 移动端 390×844 | **PASS** | `scrollWidth=390=clientWidth` 无横向溢出；左右抽屉初始在视口外、打开均在视口内（320/360px）；14 项可滚动；点最深部件 `midframe` → 选中 + 100% + 详情自动打开；「收起详情」保留选中；「详情」按钮开/关；「操作指南」入口可见且弹窗 6 条在视口内；底部坞完整可点 |
| 7 | 1600×1000 / 1100×780 面板布局 | **PASS** | 1100：左 24–296 / 右 750–1076、底 668 < 坞顶 702；1600：左 24–324 / 右 1220–1576、底 888 < 坞顶 920；顶栏品牌与按钮不重叠；中心 3D 区可命中、操作坞与规格 Tab 均可点 |
| 8 | 参数准确性 / 示意免责声明 | **PASS**（附 P2） | 35 项参数核对：33 项与 `docs/dji-action4-reference.md` 完全一致，2 项为同义改写（数值一致，见 P2-2）；「示意」免责声明 5 处可见（概览/规格脚注/主板/散热/传感器）；左侧尺寸 70.5×44.2×32.8 / 145g / 18m 一致；**额外发现 HLG 声明（P2-1，已移除）** |

## 2. 逐项细节与判定依据

- **1 加载与网络**：请求总计 18 条（含两次页面加载），全部 `file://`；`performance` 资源条目无外部域名；5 个本地资源（style.css、three-bundle、textures、model、app）均加载成功；无 console error / pageerror / 4xx。
- **2 部件一致性**：`model.parts=14`、`.part-item=14`、`.part-label=14`；逐 id 校验 labelSpec/英文名/序号一致；拆解态 `03-exploded-labels.png` 中 14 条标注全部可见、无越界隐藏。
- **3 功能按钮**：`#btnExplode` 拆解→「一键组装」、组装→「一键拆解」、`aria-pressed` 同步；`#btnReset` 复位到默认视角（误差 <0.001）并关闭自动旋转；`#btnAutoRotate` 相机绕机身转动；`#btnLabels` 可见标注 14→0→14；`#btnFocusCam` 状态/aria 同步；`#btnGuide` 弹窗三种关闭方式（×、遮罩、开始探索）均有效；规格 Tab 5 分区；`#btnFocusSelected` 在无选中时禁用、选中后能把被拖走的相机拉回；`#btnCloseInfo` 回概览。
- **4 键盘**：在点击画布/空白（activeElement=BODY）后逐键验证，均按预期；指南打开时 Space 被正确拦截；Esc 优先关弹窗再取消选中。
- **5 鼠标**：拖拽只旋转不选中（按下到抬起位移 >6px 判定为拖拽）；滚轮改变相机-目标距离；空白点击取消选中。
- **6 移动端**：`state.mobile=true`；抽屉用 `transform` 收起（rect 在视口外），打开后 rect 全部在 390×844 内；部件列表 `scrollHeight>clientHeight` 可滚动；详情面板内容渲染完整；无横向溢出（`documentElement.scrollWidth === clientWidth === 390`）。
- **7 桌面响应式**：1100 与 1600 下左右面板互不重叠、与底部操作坞无交集、顶栏品牌与按钮无重叠；`elementFromPoint` 校验中心画布与全部操作控件均命中所属元素（无被面板遮挡）。
- **8 参数**：8 个抽查值（Φ35、f/2.8、155°、前屏 1.4"/320×320、后屏 2.25"/640×360、1770mAh/6.8Wh、70.5×44.2×32.8mm、145g、18m）全部与参考文档一致；另核对了 130Mbps、10-bit D-Log M、323/326 ppi、750 nit、160min、18min/49min 充电、48kHz 16-bit AAC、microSD≤512GB exFAT、Wi-Fi ac/BLE5.0、-20~45°C/5~40°C 等，均一致；界面出现「示意」免责声明 5 处。

## 3. 问题清单（按严重程度）

### P0（阻塞）：无
### P1（严重）：无

### P2-1 「色彩 10-bit D-Log M / HLG」中的 HLG 为页面额外声明，参考文档无依据 —— **最新代码已移除**

- 快照版本（08-specs-tab.png，`js/app.js` 旧版）在「整机规格 → 影像系统 → 色彩」显示 `10-bit D-Log M / HLG`；`docs/dji-action4-reference.md` 全文 0 处 `HLG`（仅有 10-bit D-Log M，且注明为官方宣传口径）。
- **复现（快照版）**：打开页面 → 点击右侧「整机规格」→ 查看「色彩」行 → 显示 HLG；搜索文档无 HLG。
- **现状**：当前 `js/app.js` 中 `HLG` 出现次数 = 0（已按 Lead 说明移除），回归时确认该行仅剩 `10-bit D-Log M` 即可关闭。
- 证据：`08-specs-tab.png`、`results.json` → `raw.hlg`。

### P2-2 参数文档对比中的 token/格式差异（非产品数值错误）

- 2 项为同义改写而非数值冲突：
  - 页面「存储：microSD ≤512 GB · exFAT / 无内置存储」 ↔ 文档「microSD ≤512 GB，exFAT 文件系统」（分隔符/措辞不同，事实一致）。
  - 页面「无线：Wi-Fi 802.11 a/b/g/n/ac · BLE 5.0」 ↔ 文档「802.11 a/b/g/n/ac（2.4/5 GHz）+ BLE 5.0」（频段补充在文档，页面未写频段，不构成冲突）。
- 首轮自动对比因未做空白/标点归一化而误报 FAIL；归一化后 33/35 直接匹配、其余 2 项按上述判为一致。
- 证据：`results.json` → `raw.paramResults`。

### P2-3 移动端抽屉打开时瞬时 toast 遮挡面板头部 —— **最新代码已修复**

- 快照复现：390px 下页面加载后 6.7s 内 intro toast（`z-index:60`）显示时打开部件面板（`z-index:40`），toast 与面板头部重叠（实测重叠面积 ≈ 8970px²，覆盖「COMPONENTS / 部件清单」区域）。证据：`25-mobile-toast-panel-overlap.png`（修复前复现图）。
- **现状（源码核验 + 最终复跑）**：当前 `app.js` 的 `openMobilePanel()` 调用 `hideToast()`，且 `showToast()` 在任一移动端抽屉打开时直接返回；最终复跑 `mobileToastOverlap = { toastVisible:false, overlap:false, area:0 }`。关闭该 P2。

### P2-4（低影响，未修复）移动端「标注」开关无任何可见效果

- 390px 下底部操作坞仍有「标注」按钮，点按会切换 `state.labelsOn`/`aria-pressed`/toast，但：CSS `@media (max-width:680px){ .part-label{display:none} }`，且 `updateLabels` 的显示条件为 `state.exploded && state.labelsOn && width > 680` → 标注永远不可见（实测切换前后 `visible=0`、`display:none`）。
- **复现**：390×844 打开页面 → 一键拆解 → 点底部「标注」两次 → 画面无任何标注变化，仅按钮态/toast 变化。
- 建议：移动端隐藏该按钮，或提供「长按/部件列表内联标注」替代反馈。
- 证据：`24-mobile-exploded-label-toggle.png`、`results.json` → `raw.mobileLabels`。

### 观察项（P3，不阻塞）
- 部件清单重复点击已选中项会取消选中（清单语义上略反直觉，非缺陷）。
- 桌面组装态点击「标注」无可见变化（标注仅在拆解态显示，与设计一致，但 toast 提示易造成误解）。
- `Φ35`、电池仓盖 `41×28`、USB-C 盖 `17×13`、磁吸面 `46×26` 在参考文档中标注为「估算」，页面作为确定参数展示；数值与文档一致，建议后续加"约/估算"标注以贴合文档置信度。

## 4. 证据截图（均在 `qa/review/`）

| 用途 | 文件 |
|---|---|
| 1600×1000 组装态 / 拆解态 | `16-1600x1000-assembled-clean.png`、`17-1600x1000-exploded-labels-clean.png` |
| 1100×780 组装态 / 拆解态 | `20-1100x780-assembled-clean.png`、`21-1100x780-exploded-clean.png` |
| 拆解全景 / 14 条标注 / 标注关闭 | `06-1600x1000-exploded.png`、`03-exploded-labels.png`、`04-labels-off.png` |
| 清单选中 5 个代表部件 | `02-select-lens.png`、`02-select-frontScreen.png`、`02-select-rearScreen.png`、`02-select-battery.png`、`02-select-mount.png` |
| 3D 悬停提示 | `05-hover-lens.png`、`18-hover-check.png` |
| 操作指南弹窗 / 规格 Tab | `07-guide-modal.png`、`08-specs-tab.png` |
| 定位所选 | `19-focus-selected.png` |
| 移动端 390×844 组装态 / 部件面板 / 详情 / 收起 | `12-mobile-390x844-assembled.png`、`13-mobile-parts-panel.png`、`14-mobile-detail-panel.png`、`15-mobile-panels-closed.png` |
| 移动端操作指南 / 标注开关 / toast 重叠（修复前） / 干净面板 | `16-mobile-guide.png`、`24-mobile-exploded-label-toggle.png`、`25-mobile-toast-panel-overlap.png`、`26-mobile-parts-panel-clean.png` |

## 5. 验收方法（可复跑）

- 主脚本：`qa/review/verify.mjs`（69 项检查：加载/网络、14 部件、功能按钮、键盘、鼠标、移动端、双桌面视口、参数对比；真实鼠标/键盘/触摸事件为主，`window.DJI_APP` 仅用于读取状态与投影坐标辅助定位）。
- 复核脚本：`qa/review/verify2.mjs`（标注稳定态、画布点选、悬停、定位所选、归一化参数对比、移动端补测）。
- 结果数据：`results.json`（主）、`results-followup.json`（复核）、`probe-mobile-guide.json`（移动端入口探测）。
- 截图：见第 4 节；运行命令 `node qa/review/verify.mjs`（需本机 Chrome + qq-bot 下的 playwright-core）。

## 6. 最终结论

页面核心用户路径（加载、清单选中、3D 点选、一键拆解/组装、复位、自动旋转、标注、自动视角、操作指南、整机规格、键盘快捷键、拖拽/滚轮、移动端抽屉与详情、双桌面视口布局、参数一致性、示意免责）均验证通过，**无 P0/P1 缺陷，可交付**。P2 中 HLG 与移动端 toast 已由最新代码修复/移除（源码已核验），仅剩低影响的移动端「标注」死按钮与参数估算标注建议，可作为后续小版本优化项。

---

## 7. Lead 复核补充（2026-10-27 11:02，基于验收后的最终文件）

> 验收报告主体记录的是 QA 测试时的快照；此后 Lead 只做了以下收尾修复，并已用最终文件复跑关键路径。

- **P2-1 HLG**：已从 `js/app.js` 移除，最终「整机规格」色彩行仅保留 `10-bit D-Log M`。
- **P2-3 移动端 toast 遮挡**：最终代码在抽屉打开时隐藏并抑制 toast；复跑 `toastVisible=false`，无可见遮挡。
- **P2-4 移动端「标注」按钮**：已修复 —— `css/style.css` 在 `max-width:680px` 下隐藏 `#btnLabels`，与移动端不渲染标注的策略保持一致；最终移动端截图见 `screenshots/10-mobile-assembled.png` / `12-mobile-detail.png`。
- **P2-2 参数 token 差异**：保留同义写法，事实值未变，不再处理。
- **最终回归（Lead）**：14 部件/清单/标注一致；`file://` 加载无 console error、无外部请求；拖拽/滚轮、清单与画布点选、Space 组装、规格页无 HLG、移动端无横向溢出且抽屉/详情可开合；最终效果图见 `screenshots/`。
- **最终文件 SHA-256**：
  - `index.html` 17780a5d4850f67f41f338312870362dc4a0d793b3e0bbfb52bb3338be09aaec
  - `css/style.css` e0c11d278ec17a548b06efe4fb3f8dff51d0fcf615036bd42c4c842e3dbb224b
  - `js/app.js` b8e3cbac66f99195d3f5d56238e920c7bd467d87e7957120567be2c9081d4d28
  - `js/lib/model.js` 1e122895a38c66454fd29fc49ff7f0a0c002c51b1da2afe88e53897f676a2937
  - `js/lib/textures.js` 65d8051291bf887ed09b71d1f8d698f5bcec9dc3d37df2f7534f77a4d77d2dd2
  - `js/vendor/three-bundle.min.js` ff49dd7eaf4c0c5b706525c06cf385aa76012dbb87edcd2f8f26e4e939a47946

---

## 8. 画质优化复验（2026-10-27 13:00–14:00，Lead）

> 本节记录渲染画质专项优化之后的复验结果。**第 7 节的文件 SHA-256 已被本节取代。**

### 8.1 优化范围（产品行为/交互/文案不变）

- **抗锯齿（根因修复）**：整帧经由 `EffectComposer` 渲染到离屏纹理，画布级 `antialias:true` 从未真正生效。改为在 composer 的 `HalfFloat` 渲染目标上启用 **4× MSAA**（低档 2×/关闭），`antialias` 关闭以省掉无效的默认帧缓冲开销。
- **渲染管线**：ACES → **AgX** 色调映射（曝光 1.14，保留中调色彩分离）；泛光收紧并降为半分辨率；新增末段 8-bit 抖动 pass（消除暗部色带）；PCF Soft 实时阴影（主光投影 + 接地阴影，拆解时淡出）；渐变天空 + 柔光箱 PMREM 环境反射。
- **材质/贴图**：各向异性 8→16（GPU 上限）；前屏 512²→1024²、后屏 1024×576→1536×864、镀膜/光圈 512²→1024²；新增外壳「橘皮」、拉丝金属凹凸与屏幕反光贴图；标签贴图 alpha 清理（低 alpha 残差 18/102/26 → 0/0/0）；镜片镀膜叠加量 0.9→0.6。
- **几何**：倒角段 3→5、曲线段 24→36、圆柱/圆环分段提升（三角形 78.7k → 131.8k，draw call 不变）；修复三类"黑块"根因（镜圈螺纹缺口凸出、前屏连接器穿透前盖、前盖纯黑细节片）与前后屏层间 z-fighting。
- **交互视觉**：选中高亮强度 0.56→0.26（避免被选中部件整体泛白）；屏幕 HUD 排版修复（REC 与计时器重叠、FOV 徽标被录按钮遮挡、ISO/F2.8 粘连）。
- **自适应画质**：三档（MSAA 4×/2×/关闭、阴影 2048/1024/关闭、像素比 2/1.5/1、泛光联动），启动按设备选档；持续 <45 fps 自动降一档且不回升。

### 8.2 验收复跑

`node qa/review/verify.mjs`（最终代码，Chrome 155 headless + GTX 1650 真实 GPU）：

- **69/69 检查通过，8/8 验收项 PASS，fatal=[]**；
- console error / console warning / pageerror / 资源失败：**0 / 0 / 0 / 0**；
- 18 条网络请求全部为本地 `file://`，无外部域名；14 部件、点选、快捷键、移动端抽屉、双桌面视口布局与修复前一致。

**验收脚本的两处断言更新（仅测试口径，产品未改）**：`#btnLabels` 在 ≤680px 下按 P2-4 的既有修复为 `display:none`，因此把"移动端标注开关可切换"改为"按钮隐藏且不渲染任何标注"，并让移动端 `hitInfo()` 把刻意隐藏的控件记为 `hidden` 而不是"不可点击"。

### 8.3 渲染质量 / 性能审计（新增 `qa/perf/`）

`node qa/perf/render-audit.mjs --baseline --uncapped`（基线 = 优化前提交 `9edadf1` 的 git worktree；纯 canvas、固定机位、3 帧中位）：

| 指标（1600×1000） | 优化前 | 优化后 | 变化 |
| --- | --- | --- | --- |
| `edgeTransitionRatio`（DPR1，越高=过渡越平滑） | 0.331% | 0.475% | +43.8% |
| `edgeTransitionPerEdge`（DPR1） | 8.39% | 11.29% | +34.5% |
| `hfEnergy`（DPR1，越低=锯齿能量越少） | 503.3 | 335.4 | −33.4% |
| `hfEnergy`（DPR2） | 279.4 | 189.7 | −32.1% |
| 垂直同步 fps（DPR1 / DPR2） | 60.00 / 60.00 | 60.00 / 60.00 | 持平 |
| 不限帧率 fps（DPR1，越高越省） | 282.2 | 112.8 | −60.0% |
| console warning / error | 0 / 0 | 0 / 0 | 持平 |

结论：抗锯齿显著改善（DPR1 最明显，DPR2 被 2× 超采样部分掩盖）；每帧 GPU 开销约 2.4×，GTX 1650 上仍稳定 60 fps，低端集显由自适应降档兜底。完整口径、截图与复现方式见 [../perf/report.md](../perf/report.md)。

### 8.4 最终文件 SHA-256（本轮复验快照）

- `index.html` `17780a5d4850f67f41f338312870362dc4a0d793b3e0bbfb52bb3338be09aaec`
- `css/style.css` `e0c11d278ec17a548b06efe4fb3f8dff51d0fcf615036bd42c4c842e3dbb224b`
- `js/app.js` `648042933df63e0845bcba4d335062b76e5d4ba9dae5768ff03dce17acd0a663`
- `js/lib/model.js` `373a6adfd44f373ae61252d7ebcc7ef79cbd9627d104c63ee27fa5bda50d2c1a`
- `js/lib/textures.js` `f4808fef7dd482d90a0e1a0312dedeece8fd1e9215b4236c1a10d438b0b7d2ff`
- `js/vendor/three-bundle.min.js` `ff49dd7eaf4c0c5b706525c06cf385aa76012dbb87edcd2f8f26e4e939a47946`
