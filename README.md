# DJI Osmo Action 4 · 3D 拆解实验室

一个完全由代码生成、可交互的 DJI Osmo Action 4 三维拆解可视化页面。使用 **Three.js + HTML + CSS + JavaScript**，不依赖任何外部 3D 模型、图片、字体或在线 CDN —— 所有几何体、贴图、屏幕 UI、PCB、镜头镀膜、电池铭牌均由代码在浏览器运行时生成。

![整机视图](screenshots/01-assembled.png)

![爆炸拆解视图](screenshots/02-exploded-overview.png)

![移动端](screenshots/10-mobile-assembled.png)

## 快速开始

直接双击 `index.html` 即可（`file://` 下可正常运行，无需构建、无需本地服务器）。

如需通过 HTTP 访问：

```bash
# 任选一种，在项目目录下执行
python -m http.server 8080
# 或
npx serve .
```

然后打开 <http://localhost:8080>。推荐使用最新版 Chrome / Edge（需要 WebGL 2）。

## 功能

- **程序化 3D 机身**：按官方 70.5 × 44.2 × 32.8 mm 比例建模，还原正面右侧 Φ35 镜头、左侧 1.4" 方形前屏、顶部红环快门、右侧 QS 键与 USB-C 盖、左侧电池仓盖、底部磁吸快拆接口。
- **点击拆解**：点击任意部件，整机进入爆炸拆解动画；镜头自动飞向该部件、发光高亮，并展示参数详情。
- **自由视角**：鼠标拖拽 360° 旋转、滚轮缩放、右键平移；移动端单指旋转、双指缩放/平移。相机带阻尼。
- **部件标注**：拆解后显示每个部件的名称与关键参数，带科技感引线；选中部件时其他标注自动淡出，避免遮挡。
- **部件清单 / 参数说明**：左侧 14 个部件清单，右侧「部件详情 / 整机规格」面板，含材质、参数、拆解说明。
- **一键拆解 / 组装**、**复位视角**、**自动旋转**、**标注开关**、**自动视角开关**、**全屏**、**操作指南弹窗**。
- **响应式**：桌面双面板布局；≤960px 自动切换为抽屉式面板 + 移动端相机参数，手机竖屏可完整看到整机。
- 深色科技背景：HUD 环、刻度、粒子、程序化环境反射、Bloom 泛光、玻璃拟态 UI、扫描线与暗角。

## 交互与快捷键

| 操作 | 说明 |
| --- | --- |
| 拖拽 / 单指拖动 | 旋转视角 |
| 滚轮 / 双指捏合 | 缩放 |
| 右键拖拽 / 双指拖动 | 平移 |
| 点击部件 | 拆解 + 选中 + 查看详情 |
| 点击空白 | 取消选中（拆解状态保留） |
| `Space` | 拆解 / 组装 |
| `R` | 复位视角 |
| `L` | 标注开关 |
| `F` | 全屏 |
| `H` / `?` | 操作指南 |
| `Esc` | 关闭弹窗 / 取消选中 |

## 14 个可拆解部件

| # | 部件 | 关键参数 |
| --- | --- | --- |
| 01 | 镜头模组 | 155° FOV · f/2.8 · Φ35 mm 旋入式保护盖 |
| 02 | 1/1.3" CMOS | 3648 × 2736 · 约 1000 万像素 · 4K/120 |
| 03 | 前盖组件 | 70.5 × 44.2 mm · R3 圆角 · 哑光复合材质 |
| 04 | 1.4" 前置屏 | 320 × 320 · 323 ppi · 750 nit · 触控 |
| 05 | 主板 | 影像 SoC · Wi-Fi ac + BLE 5.0（内部示意） |
| 06 | 散热系统 | 铜均热板 + 石墨片（内部示意） |
| 07 | 1770mAh 电池 | 6.8 Wh · 3.85 V · 约 160 min 续航 |
| 08 | 电池仓盖 | 左侧 41 × 28 mm · 红色到位标记 |
| 09 | USB-C 保护盖 | 右侧下后部 · 30 W 快充 |
| 10 | 后盖组件 | 2.25" 屏框 · 金属屏蔽片 |
| 11 | 2.25" 触控屏 | 640 × 360 · 326 ppi · 750 nit |
| 12 | 按键组 | Φ13 快门红环 · QS 快切 · 4 孔扬声器 |
| 13 | 磁吸快拆底座 | 46 × 26 mm 贴合面 · 双侧卡槽 |
| 14 | 一体化中框 | 承力骨架 · 电池仓 · 双层密封 |

## 视觉与实现

- **几何**：`ExtrudeGeometry` 圆角外壳、`RoundedBoxGeometry`、`Lathe/Cylinder/Torus` 镜筒、自定义 `BufferGeometry` 粒子与刻度环；电脑主板、电池、镜头均为代码组件拼装。
- **贴图**：`CanvasTexture` 实时绘制前置/后置屏预览 UI、PCB 走线与丝印、电池铭牌、滚花/噪点/螺丝/镜头镀膜/UI 屏幕。
- **渲染**：`MeshPhysicalMaterial`（清漆、虹彩 CMOS）、程序化 PMREM 环境反射、ACES Filmic 色调映射、`UnrealBloomPass` 辉光、指数雾、程序化地面网格 shader。
- **动画**：自研时间轴（无 GSAP 等动画库），部件错峰爆炸、选中部件二次偏移、相机球面缓动、辉光脉冲。
- **UI**：原生 DOM + CSS（玻璃拟态、CSS 变量按部件主题色切换）；3D 标注使用 HTML + SVG 引线，屏幕空间约束与简单防重叠。
- **性能**：像素比上限 2、自适应降分辨率、rAF 单循环、纹理惰性生成。

## 目录结构

```text
dji-action4-3d/
├─ index.html                     # 页面骨架与 UI
├─ css/style.css                  # 视觉样式、动效、响应式
├─ js/
│  ├─ vendor/three-bundle.min.js  # Three.js r169 + 官方 addons（MIT，已本地化）
│  ├─ lib/textures.js             # 全部 Canvas 程序化贴图
│  ├─ lib/model.js                # Action 4 程序化模型与 14 个部件
│  └─ app.js                      # 场景/相机/交互/拆解动画/UI 逻辑
├─ docs/dji-action4-reference.md  # 官方资料调研与建模坐标参考
├─ qa/review/review-report.md     # 独立验收报告（8/8 验收项通过，无 P0/P1）
├─ screenshots/                   # 效果截图
├─ LICENSE                        # 本项目 MIT License
├─ THIRD-PARTY-NOTICES.md         # 第三方许可
└─ README.md
```

## 验收

在 Chrome（WebGL 2 / NVIDIA 加速）下完成独立验收：**8/8 验收项 PASS，无 P0 / P1 缺陷**；自动化检查覆盖加载、14 部件一致性、全部按钮/快捷键、鼠标拖拽与滚轮、3D 点选、移动端抽屉与详情、1100 / 1600 双桌面视口、参数与官方资料一致性等。详见 [qa/review/review-report.md](qa/review/review-report.md)。


## 数据来源与免责声明

- 外观布局、屏幕规格、影像、电池、防水等依据 **DJI 官方规格页 / 用户手册 v1.2 / 官方产品图** 整理，详见 [docs/dji-action4-reference.md](docs/dji-action4-reference.md)。
- **内部结构（主板、散热、密封、拆解顺序）官方未公开**，页面中的内部件仅作「示意级」可视化表达，不代表真实拆解图；面板中已标注。
- DJI、Osmo Action 是 DJI 的商标。本项目为个人学习/展示用途的非官方可视化作品，与 DJI 无关联。

## 第三方许可

Three.js 及其官方 addons 以 MIT License 分发，版权归 Three.js Authors 所有；许可全文与本地化说明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。本项目页面代码同样以 MIT License 提供。
