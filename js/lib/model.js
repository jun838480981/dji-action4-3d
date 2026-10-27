/* ============================================================
   model.js — DJI Osmo Action 4, built entirely from Three.js
   primitives / extruded shapes. 1 unit = 1 cm.
   Body: 7.05 (W/X) × 4.42 (H/Y) × 3.28 (D/Z). Lens faces +Z.
   Reference: docs/dji-action4-reference.md (official manual layout).
   ============================================================ */
(function () {
  'use strict';
  const B = window.THREE_BUNDLE;
  const THREE = B.THREE;
  const RoundedBoxGeometry = B.RoundedBoxGeometry;
  window.DJI = window.DJI || {};
  const T = window.DJI.textures || {};

  /* ---------- dimensions ---------- */
  const W = 7.05, H = 4.42, D = 3.28;
  const HW = W / 2, HH = H / 2, HD = D / 2;
  const CORNER = 0.32;                 // ~3 mm corner radius, per reference
  const LENS = { x: 1.45, y: 0.15 };   // lens on the viewer's right
  const SCR = {
    x: -1.90, y: 0.00,                 // front screen module centre
    moduleW: 2.75, moduleH: 3.10,      // black glass module (approx.)
    active: 2.52, activeY: 0.16        // effective 25.2 mm, 320×320
  };

  /* ---------- part metadata ---------- */
  const META = [
    {
      id: 'lens', name: '镜头模组', en: 'LENS MODULE', cat: 'OPTICS / 光学',
      accent: '#5fe8ff', labelSpec: 'Φ35 · f/2.8',
      desc: 'Action 4 的 155° 超广角光学模组位于正面右侧，外圈是可旋下的滚花镜头保护盖，中央为 Φ20 mm 前组玻璃。镜头同时是整机防水密封的关键一环。',
      specs: [
        ['视场角', '155°（对角）'], ['光圈', 'f/2.8'], ['对焦范围', '0.4 m ~ ∞'],
        ['保护盖', 'Φ35 mm 旋入式'], ['前组玻璃', 'Φ20 mm 深色镀膜'],
        ['密封', '旋紧后参与 18 m 防水'], ['固定', '螺钉 + 镜座']
      ],
      tags: ['滚花保护盖', '多层镀膜', '防水密封件'],
      note: '镜头保护盖必须旋紧才能保证防水；拆下后可见前组玻璃、镜片组与后方的 CMOS 影像模组。',
      explode: [0.15, 2.6, 4.7], explodeRot: [-9, 8, 3],
      view: { az: 0.32, el: 0.04, r: 17.5 }, labelDir: [185, -125],
      anchorAbs: [LENS.x, LENS.y + 1.9, 2.0]
    },
    {
      id: 'sensor', name: '1/1.3" CMOS', en: 'IMAGE SENSOR', cat: 'IMAGING / 影像',
      accent: '#a78bfa', labelSpec: '1/1.3" · 1000万像素',
      desc: '1/1.3 英寸 CMOS 位于镜头正后方，照片输出 3648 × 2736（约 1000 万像素），配合 f/2.8 大光圈与 10-bit D-Log M 提升暗光与后期空间。',
      specs: [
        ['传感器', '1/1.3 英寸 CMOS'], ['照片', '3648 × 2736 · 约 1000 万像素'],
        ['视频', '4K 16:9 ≤ 120fps'], ['色彩', '10-bit D-Log M'],
        ['防抖', 'RockSteady 3.0 / 地平线增稳'], ['位置', '镜头正后方']
      ],
      tags: ['1/1.3" 大底', '1000 万像素', '10-bit 色彩'],
      note: '传感器与镜头组构成独立的影像模块，通过 FPC 排线与主板连接；内部结构为示意级还原。',
      explode: [-1.5, 1.2, 2.5], explodeRot: [6, -10, -6],
      view: { az: 0.28, el: 0.15, r: 17.0 }, labelDir: [155, 40],
      anchorAbs: [LENS.x, LENS.y + 1.25, 1.48]
    },
    {
      id: 'frontCover', name: '前盖组件', en: 'FRONT COVER', cat: 'STRUCTURE / 结构',
      accent: '#60a5fa', labelSpec: '复合材质 · 密封压合',
      desc: '正面外壳承载镜头、1.4 英寸前置屏与麦克风开孔，采用深灰哑光复合材质。镜圈、前屏、dji 标与「OSMO ACTION 4」丝印均位于这一面。',
      specs: [
        ['外形尺寸', '70.5 × 44.2 mm'], ['材质', '高强度复合材质'], ['表面', '深灰哑光涂层'],
        ['圆角', '正面轮廓 R3'], ['开孔', '镜头孔 / 前置屏视窗'], ['密封', '边缘防水压合']
      ],
      tags: ['复合材质', '哑光表面', 'R3 圆角'],
      note: '前盖与中框之间由密封结构压合，是整机防水与镜头法兰的安装基准。',
      explode: [-2.2, -2.5, 4.0], explodeRot: [12, 22, -5],
      view: { az: 0.02, el: 0.12, r: 17.8 }, labelDir: [-165, 150],
      anchorAbs: [0, 1.9, 1.66]
    },
    {
      id: 'frontScreen', name: '1.4" 前置屏', en: 'FRONT DISPLAY', cat: 'DISPLAY / 显示',
      accent: '#2dd4bf', labelSpec: '1.4" · 320×320',
      desc: '正面左侧的 1.4 英寸方形触控屏，320 × 320 分辨率、323 ppi、750 cd/m² 亮度，用于自拍取景与参数监看；左下角印有 dji 标。',
      specs: [
        ['屏幕尺寸', '1.4 英寸'], ['分辨率', '320 × 320（方形）'], ['像素密度', '323 ppi'],
        ['亮度', '750 ± 50 cd/m²'], ['触控', '支持'], ['有效面积', '25.2 × 25.2 mm'],
        ['表面', '黑色玻璃模组']
      ],
      tags: ['1.4 英寸方形屏', '触控取景', '750 nit'],
      note: '前后屏不能同时触控：一块操作时另一块会锁定。屏模组通过短 FPC 排线接入主板。',
      explode: [-2.4, 2.3, 4.3], explodeRot: [10, 12, 4],
      view: { az: -0.45, el: 0.12, r: 17.0 }, labelDir: [-190, -135],
      anchorAbs: [SCR.x, 1.7, 1.74]
    },
    {
      id: 'mainboard', name: '主板', en: 'MAINBOARD', cat: 'ELECTRONICS / 电子',
      accent: '#4ade80', labelSpec: 'SoC · Wi-Fi ac',
      desc: '整机的控制中枢：影像处理 SoC、内存、Wi-Fi 802.11ac / BLE 5.0 模块、IMU 与电源管理集中在这块高密度主板上，通过多组 FPC 连接各模组。',
      specs: [
        ['核心', '影像处理 SoC'], ['无线', 'Wi-Fi 802.11ac + BLE 5.0'],
        ['存储', 'microSD ≤ 512 GB'], ['接口', 'USB-C / FPC 排线'],
        ['传感', 'IMU 惯性测量单元'], ['说明', '内部结构为示意，非官方拆解图']
      ],
      tags: ['HDI 主板', '影像 SoC', '屏蔽罩'],
      note: 'DJI 未公开主板布局，此处的元件位置为可视化示意；真实主板纵向布置在镜头后方。',
      explode: [1.2, 0.8, 1.4], explodeRot: [4, 14, -8],
      view: { az: -0.45, el: 0.2, r: 17.5 }, labelDir: [-215, 15],
      anchorAbs: [1.0, 1.55, 0.25]
    },
    {
      id: 'cooling', name: '散热系统', en: 'COOLING SYSTEM', cat: 'THERMAL / 热管理',
      accent: '#fb923c', labelSpec: '铜均热板 · 石墨片',
      desc: '在无风扇、无外露散热孔的防水机身里，热量主要依赖镜头金属环、前壳与内部均热/屏蔽结构被动导出。此处以铜均热板与石墨片作示意表达。',
      specs: [
        ['结构', '铜均热板 + 石墨片'], ['散热面', '铝合金鳍片'], ['导热', '导热硅脂 / 导热垫'],
        ['目标', '4K 长时间录制温控'], ['说明', '官方未公开，示意结构'], ['安装', '主板背面']
      ],
      tags: ['铜均热板', '石墨导热', '被动散热'],
      note: '机身没有风扇与外露散热孔（防水所需），实际散热方案未经官方证实，此处为示意级可视化。',
      explode: [1.4, -1.4, -0.8], explodeRot: [-5, 10, 9],
      view: { az: -0.55, el: 0.08, r: 17.5 }, labelDir: [-200, 125],
      anchorAbs: [1.0, -0.95, -0.65]
    },
    {
      id: 'battery', name: '1770mAh 电池', en: 'EXTREME BATTERY', cat: 'POWER / 电源',
      accent: '#facc15', labelSpec: '1770mAh · 6.8Wh',
      desc: 'Osmo Action 耐寒长续航电池，1770 mAh / 6.8 Wh，从机身左侧横向插入。官方数据：25℃ 环境下 1080p/24fps 可录制约 160 分钟。',
      specs: [
        ['容量', '1770 mAh'], ['能量', '6.8 Wh'], ['电压', '3.85 V · LiPo 1S'],
        ['续航', '约 160 分钟（1080p/24fps）'], ['充电', '30 W：18 min 充至 80%'],
        ['温度', '-20°C ~ 45°C 使用'], ['安装', '左侧横向插入']
      ],
      tags: ['1770mAh', '耐寒电池', '左侧抽换'],
      note: '打开左侧电池仓盖后沿 +X 方向把电池推入，盖板压到红色标记不露出才算锁定到位。',
      explode: [-2.2, -0.1, 0.8], explodeRot: [2, 8, 10],
      view: { az: -1.45, el: 0.16, r: 17.4 }, labelDir: [-195, -55],
      anchorAbs: [-1.8, 1.9, -0.2]
    },
    {
      id: 'batteryDoor', name: '电池仓盖', en: 'BATTERY DOOR', cat: 'STRUCTURE / 结构',
      accent: '#fde047', labelSpec: '左侧 · 红色到位标记',
      desc: '覆盖左侧面的大面积电池仓盖，内置密封圈，前下区域带解锁键与红色到位标记。microSD 卡槽也位于同一侧，开盖后即可取放。',
      specs: [
        ['位置', '机身左侧（-X）'], ['尺寸', '约 41 × 28 mm'],
        ['密封', '内侧防水胶圈'], ['锁定', '解锁键 + 红色到位标记'],
        ['同侧', 'microSD 卡槽'], ['材质', '复合材质']
      ],
      tags: ['左侧大盖', '红色到位标记', 'microSD'],
      note: '盖板必须压到红色标记完全被遮住才表示密封到位；这是官方明确强调的防水操作要点。',
      explode: [-2.7, 1.0, 1.6], explodeRot: [4, 18, -6],
      view: { az: -1.45, el: 0.1, r: 17.4 }, labelDir: [-220, 45],
      anchorAbs: [-3.6, 0.9, 0.4]
    },
    {
      id: 'usbDoor', name: 'USB-C 保护盖', en: 'USB-C DOOR', cat: 'STRUCTURE / 结构',
      accent: '#38bdf8', labelSpec: '右侧 · USB-C',
      desc: '右侧面下后部的独立 USB-C 保护盖，带铰链与解锁键。内部为 USB-C 接口，支持 30 W 快充、数据传输与网络摄像头模式。',
      specs: [
        ['位置', '机身右侧下后部'], ['尺寸', '约 17 × 13 mm'],
        ['接口', 'USB-C 充电 / 数据传输'], ['结构', '铰链盖 + 解锁键'],
        ['密封', '内侧防水胶圈'], ['充电', '30 W · 49 min 充满']
      ],
      tags: ['USB-C', '铰链保护盖', '30W 快充'],
      note: '充电或使用网络摄像头模式前需要掀开保护盖；使用后务必压紧，否则会破坏 18 m 防水。',
      explode: [2.9, -0.7, -0.3], explodeRot: [-4, -16, 8],
      view: { az: 1.45, el: 0.1, r: 17.3 }, labelDir: [205, 55],
      anchorAbs: [3.6, -0.9, -0.6]
    },
    {
      id: 'rearCover', name: '后盖组件', en: 'REAR COVER', cat: 'STRUCTURE / 结构',
      accent: '#818cf8', labelSpec: '2.25" 屏框 · 屏蔽',
      desc: '后壳承载 2.25 英寸触控屏，内侧贴有金属屏蔽片。外观无可见外露螺钉，与前壳、中框一起构成整机承力与防水外壳。',
      specs: [
        ['外形尺寸', '70.5 × 44.2 mm'], ['材质', '深灰哑光复合材质'],
        ['屏幕开孔', '2.25 英寸 · 52 mm 模组'], ['内侧', '金属屏蔽片'],
        ['指示灯', '状态指示灯 II'], ['固定', '内部卡扣（官方未公开）']
      ],
      tags: ['2.25" 屏框', '金属屏蔽', '无外露螺钉'],
      note: '后盖内侧的金属屏蔽片用于隔离屏幕与主板之间的电磁干扰；内部固定方式官方未公开。',
      explode: [0, 1.4, -3.7], explodeRot: [-8, 0, 4],
      view: { az: Math.PI - 0.2, el: 0.18, r: 17.8 }, labelDir: [175, 150],
      anchorAbs: [0, -1.6, -1.68]
    },
    {
      id: 'rearScreen', name: '2.25" 触控屏', en: 'REAR TOUCHSCREEN', cat: 'DISPLAY / 显示',
      accent: '#f472b6', labelSpec: '2.25" · 640×360',
      desc: '2.25 英寸横屏触控屏，360 × 640 分辨率、326 ppi、750 cd/m² 高亮，是 Action 4 的主要交互界面，支持触控对焦、参数调节与回放。',
      specs: [
        ['屏幕尺寸', '2.25 英寸（横屏）'], ['分辨率', '640 × 360'], ['像素密度', '326 ppi'],
        ['亮度', '750 ± 50 cd/m²'], ['触控', '支持'], ['有效面积', '49.9 × 28.1 mm'],
        ['模组尺寸', '约 52 × 30.2 mm']
      ],
      tags: ['2.25 英寸横屏', '触控操作', '750 nit'],
      note: '前后屏不能同时触控；屏幕模组通过 FPC 排线连接主板，拆下后盖与屏蔽片后可整体分离。',
      explode: [0, -1.2, -5.2], explodeRot: [6, 0, -4],
      view: { az: Math.PI, el: 0.12, r: 18.4 }, labelDir: [190, -145],
      anchorAbs: [0, 1.2, -1.82]
    },
    {
      id: 'buttons', name: '按键组', en: 'BUTTONS & SPEAKER', cat: 'CONTROL / 操控',
      accent: '#f87171', labelSpec: '快门红环 · QS',
      desc: '顶部偏左前缘的拍摄按键（带红色装饰环），右侧面上部的 QS 快速切换键，以及顶部镜头侧的 4 孔扬声器。按键采用密封结构，可在水下操作。',
      specs: [
        ['拍摄按键', 'Φ13 mm · 红色装饰环'], ['位置', '顶部偏 -X / 偏前缘'],
        ['QS 键', '右侧面上部 · 竖排 QS 丝印'], ['扬声器', '顶部 4 孔（镜头侧前缘）'],
        ['密封', '支持水下按压'], ['材质', '金属 + 复合材质']
      ],
      tags: ['快门红环', 'QS 快切', '4 孔扬声器'],
      note: '拍摄按键同时承担开关机功能；QS 键用于快速切换拍摄模式。两者均通过密封结构穿过机身。',
      explode: [-0.4, 3.0, 0.8], explodeRot: [10, -6, 0],
      view: { az: -0.25, el: 0.65, r: 16.8 }, labelDir: [-90, -195],
      anchorAbs: [-1.2, 2.55, 0.4]
    },
    {
      id: 'mount', name: '磁吸快拆底座', en: 'MAGNETIC MOUNT', cat: 'MOUNT / 接口',
      accent: '#94a3b8', labelSpec: '46×26 磁吸面 · 双卡槽',
      desc: '底部磁吸快拆接口：约 46 × 26 mm 的磁吸贴合面，左右各有一个快拆卡槽，转接件的锁扣从两侧卡入。防风麦克风位于底面 -X 端。',
      specs: [
        ['贴合面', '约 46 × 26 mm'], ['结构', '磁吸 + 双侧机械锁扣'],
        ['卡槽', 'X ≈ ±11 mm · 4 × 14 mm'], ['防风麦克风', '底面 -X 端'],
        ['兼容', 'Osmo Action 快拆转接件'], ['螺孔', '机身无 1/4" 螺孔（转接件提供）']
      ],
      tags: ['磁吸快拆', '双卡槽', '防风麦克风'],
      note: '向下按压相机让转接件锁扣完全嵌入两侧卡槽即可锁定；1/4 螺孔由随附快拆转接件提供。',
      explode: [0, -2.4, 0.5], explodeRot: [0, 8, 0],
      view: { az: 0.4, el: -0.27, r: 15.8 }, labelDir: [-150, 175],
      anchorAbs: [0, -2.5, 0.6]
    },
    {
      id: 'midframe', name: '一体化中框', en: 'MID FRAME', cat: 'STRUCTURE / 结构',
      accent: '#fbbf24', labelSpec: '结构骨架 · 电池仓',
      desc: '连接前后壳的承力骨架，集成螺钉柱、电池仓、两侧接口与密封槽。左侧为电池仓开盖区域，右侧承载 QS 键与 USB-C 保护盖。',
      specs: [
        ['结构', '一体化中框骨架'], ['材质', '复合材质 / 金属骨架'],
        ['左侧', '电池仓 + microSD'], ['右侧', 'QS 键 + USB-C'],
        ['密封', '前后双层胶圈'], ['安装基准', '镜头 / 主板 / 电池 / 底座']
      ],
      tags: ['承力骨架', '电池仓', '双层密封'],
      note: '中框是全部部件的安装基准；拆掉前后壳后，电池仓、主板安装柱与防水密封槽都集中在这里。',
      explode: [0, 0, 0], explodeRot: [0, 0, 0],
      view: { az: 0.8, el: 0.22, r: 17.4 }, labelDir: [205, 85],
      anchorAbs: [3.1, -1.5, 0.3]
    }
  ];

  /* ---------- materials factory ---------- */
  // textures.js may land its micro-detail maps after this file is upgraded;
  // probe them defensively so model.js keeps working either way.
  function texIf(name) {
    const fn = T && T[name];
    return typeof fn === 'function' ? fn() : null;
  }
  function withBump(opts, map, scale) {
    if (map && scale) { opts.bumpMap = map; opts.bumpScale = scale; }
    return opts;
  }

  function makeMaterials() {
    const shellBump = texIf('shellBump');
    const brushedBump = texIf('brushedBump');
    const screenGlare = texIf('screenGlare');

    // powder-coated composite: the bump map breaks up the clearcoat highlight
    // so the radius reads as a machined bevel instead of a flat silhouette.
    const shell = new THREE.MeshPhysicalMaterial(withBump({
      color: 0x1b1e23, metalness: 0.3, roughness: 0.5,
      clearcoat: 0.3, clearcoatRoughness: 0.46,
      roughnessMap: T.speckle(), envMapIntensity: 1.02
    }, shellBump, 0.006));
    const shellDark = new THREE.MeshStandardMaterial(withBump({
      color: 0x101216, metalness: 0.22, roughness: 0.61,
      roughnessMap: T.speckle(), envMapIntensity: 0.74
    }, shellBump, 0.005));
    // anodised / bead-blasted metal with directional brushing relief
    const frame = new THREE.MeshStandardMaterial(withBump({
      color: 0x2a2e33, metalness: 0.85, roughness: 0.37,
      roughnessMap: T.brushedMetal(), envMapIntensity: 1.28
    }, brushedBump, 0.0045));
    const lensRing = new THREE.MeshStandardMaterial({
      color: 0x2f343a, metalness: 0.88, roughness: 0.42,
      bumpMap: T.knurlBump(), bumpScale: 0.018, envMapIntensity: 0.88
    });
    const blackGloss = new THREE.MeshPhysicalMaterial({
      color: 0x05070a, metalness: 0.42, roughness: 0.14,
      clearcoat: 1, clearcoatRoughness: 0.055, envMapIntensity: 1.55
    });
    // cover glass: iridescent coating + a faint baked-in reflection streak.
    // Using an emissiveMap instead of an extra additive plane keeps the
    // mesh / draw-call / pickable count exactly where it was.
    const glassOpts = {
      color: 0x0b1520, metalness: 0.0, roughness: 0.05,
      transparent: true, opacity: 0.27, clearcoat: 1, clearcoatRoughness: 0.04,
      envMapIntensity: 1.5, depthWrite: false,
      iridescence: 0.3, iridescenceIOR: 1.32, iridescenceThicknessRange: [120, 420],
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    };
    if (screenGlare) {
      glassOpts.emissiveMap = screenGlare;
      glassOpts.emissive = new THREE.Color(0xdfefff);
      glassOpts.emissiveIntensity = 0.5;
    }
    const glass = new THREE.MeshPhysicalMaterial(glassOpts);
    const lensGlass = new THREE.MeshPhysicalMaterial({
      color: 0x08111b, metalness: 0.0, roughness: 0.06,
      transparent: true, opacity: 0.17, clearcoat: 0.7, clearcoatRoughness: 0.05,
      envMapIntensity: 0.8, depthWrite: false,
      iridescence: 0.55, iridescenceIOR: 1.42, iridescenceThicknessRange: [180, 560],
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const screenBezel = new THREE.MeshPhysicalMaterial({
      color: 0x030405, metalness: 0.5, roughness: 0.12,
      clearcoat: 1, clearcoatRoughness: 0.045, envMapIntensity: 1.45
    });
    const copper = new THREE.MeshStandardMaterial({
      color: 0xb87045, metalness: 1, roughness: 0.35, envMapIntensity: 1.35
    });
    const aluminum = new THREE.MeshStandardMaterial(withBump({
      color: 0x8d969c, metalness: 1, roughness: 0.42, envMapIntensity: 1.32
    }, brushedBump, 0.005));
    const graphite = new THREE.MeshStandardMaterial({
      color: 0x23262a, metalness: 0.5, roughness: 0.7, envMapIntensity: 0.8
    });
    const mountMetal = new THREE.MeshStandardMaterial(withBump({
      color: 0x1b1e22, metalness: 0.88, roughness: 0.33,
      roughnessMap: T.brushedMetal(), envMapIntensity: 1.12
    }, brushedBump, 0.006));
    const rubber = new THREE.MeshStandardMaterial({
      color: 0x07090b, metalness: 0.0, roughness: 0.94, envMapIntensity: 0.4
    });
    const gold = new THREE.MeshStandardMaterial({
      color: 0xd8ad55, metalness: 1, roughness: 0.26, envMapIntensity: 1.4
    });
    const red = new THREE.MeshPhysicalMaterial({
      color: 0xd9232c, metalness: 0.28, roughness: 0.32,
      clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.2
    });
    const whitePlastic = new THREE.MeshStandardMaterial({
      color: 0xd9dde0, metalness: 0.1, roughness: 0.55
    });
    const pcbFace = new THREE.MeshStandardMaterial({
      map: T.pcb(), color: 0xffffff, metalness: 0.25, roughness: 0.6, envMapIntensity: 0.8
    });
    const pcbEdge = new THREE.MeshStandardMaterial({ color: 0x091310, metalness: 0.2, roughness: 0.72 });
    const screenRear = new THREE.MeshBasicMaterial({ map: T.screenRear(), toneMapped: false });
    const screenFront = new THREE.MeshBasicMaterial({ map: T.screenFront(), toneMapped: false });
    const screw = new THREE.MeshStandardMaterial({
      map: T.screw(), transparent: true, alphaTest: 0.3,
      metalness: 0.9, roughness: 0.32, envMapIntensity: 1.3,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    // silk prints: a high alphaTest plus polygon offset drops the dark fringe
    // that used to outline every glyph against the shell.
    const logo = new THREE.MeshStandardMaterial({
      map: T.logo(), transparent: true, alphaTest: 0.45, roughness: 0.5, metalness: 0.1,
      color: 0xffffff, opacity: 0.9, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
    const actionLogo = new THREE.MeshStandardMaterial({
      map: T.actionLogo(), transparent: true, alphaTest: 0.45, roughness: 0.6, metalness: 0.05,
      opacity: 0.92, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
    const batteryLabel = new THREE.MeshStandardMaterial({
      map: T.batteryLabel(), metalness: 0.25, roughness: 0.52, envMapIntensity: 0.8,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const mic = new THREE.MeshStandardMaterial({
      map: T.micGrille(), metalness: 0.4, roughness: 0.72, envMapIntensity: 0.6
    });
    const qsLabel = new THREE.MeshStandardMaterial({
      map: T.qsLabel(), transparent: true, alphaTest: 0.45, roughness: 0.6, metalness: 0.2,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
    // flat, unlit black discs on the front face read as black stickers. A lit,
    // high-roughness dark material reads as a drilled recess, and polygon
    // offset plus a small physical offset keeps it clear of the shell plane.
    const detailDark = new THREE.MeshStandardMaterial({
      color: 0x080b0e, metalness: 0.3, roughness: 0.6, envMapIntensity: 0.55,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const grilleDark = new THREE.MeshStandardMaterial({
      color: 0x04060a, metalness: 0.12, roughness: 0.86, envMapIntensity: 0.32
    });
    return {
      shell, shellDark, frame, lensRing, blackGloss, glass, lensGlass, screenBezel, copper,
      aluminum, graphite, rubber, gold, red, whitePlastic, pcbFace, pcbEdge,
      screenRear, screenFront, screw, logo, actionLogo, batteryLabel, mic, qsLabel, mountMetal,
      detailDark, grilleDark
    };
  }

  let MAT = null;

  /* ---------- geometry helpers ---------- */
  function roundedRectShape(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    r = Math.min(r, w / 2, h / 2);
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    s.closePath();
    return s;
  }
  function roundedRectPath(w, h, r) {
    const p = new THREE.Path();
    const x = -w / 2, y = -h / 2;
    r = Math.min(r, w / 2, h / 2);
    p.moveTo(x + r, y);
    p.lineTo(x + w - r, y);
    p.quadraticCurveTo(x + w, y, x + w, y + r);
    p.lineTo(x + w, y + h - r);
    p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    p.lineTo(x + r, y + h);
    p.quadraticCurveTo(x, y + h, x, y + h - r);
    p.lineTo(x, y + r);
    p.quadraticCurveTo(x, y, x + r, y);
    p.closePath();
    return p;
  }
  function shellPlateGeo(w, h, totalDepth, bevel, cornerR) {
    const depth = Math.max(0.02, totalDepth - bevel * 2);
    const shape = roundedRectShape(w - bevel * 2, h - bevel * 2, Math.max(0.04, cornerR - bevel));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: depth, bevelEnabled: true, bevelSegments: 5, steps: 1,
      bevelSize: bevel, bevelThickness: bevel, curveSegments: 36
    });
    geo.translate(0, 0, -depth / 2);
    return geo;
  }
  function roundedRectPoints(w, h, r, z, arcSeg) {
    arcSeg = arcSeg || 10;
    const pts = [];
    const x = -w / 2, y = -h / 2;
    function arc(cx, cy, a0, a1) {
      for (let i = 0; i <= arcSeg; i++) {
        const a = a0 + (a1 - a0) * (i / arcSeg);
        pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z));
      }
    }
    arc(x + w - r, y + r, Math.PI / 2, 0);
    arc(x + w - r, y + h - r, 0, -Math.PI / 2);
    arc(x + r, y + h - r, -Math.PI / 2, -Math.PI);
    arc(x + r, y + r, Math.PI, Math.PI / 2);
    return pts;
  }

  function add(g, geo, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    g.add(m);
    return m;
  }
  function box(g, w, h, d, mat, x, y, z, rx, ry, rz) {
    return add(g, new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz);
  }
  function rbox(g, w, h, d, radius, mat, x, y, z, rx, ry, rz) {
    return add(g, new RoundedBoxGeometry(w, h, d, 4, radius), mat, x, y, z, rx, ry, rz);
  }
  function cylZ(g, rTop, rBot, h, seg, mat, x, y, z, open) {
    return add(g, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!open), mat, x, y, z, Math.PI / 2, 0, 0);
  }
  function cylY(g, rTop, rBot, h, seg, mat, x, y, z, open) {
    return add(g, new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!open), mat, x, y, z);
  }
  function torus(g, radius, tube, mat, x, y, z, rx, ry, rz, seg) {
    return add(g, new THREE.TorusGeometry(radius, tube, 14, seg || 64), mat, x, y, z, rx, ry, rz);
  }
  function plane(g, w, h, mat, x, y, z, rx, ry, rz) {
    return add(g, new THREE.PlaneGeometry(w, h), mat, x, y, z, rx, ry, rz);
  }
  function screw(g, x, y, z, facing, size) {
    size = size || 0.09;
    const m = new THREE.Mesh(new THREE.CircleGeometry(size, 24), MAT.screw);
    m.position.set(x, y, z);
    if (facing === 'back') m.rotation.y = Math.PI;
    if (facing === 'up') m.rotation.x = -Math.PI / 2;
    if (facing === 'down') m.rotation.x = Math.PI / 2;
    if (facing === 'right') m.rotation.y = Math.PI / 2;
    if (facing === 'left') m.rotation.y = -Math.PI / 2;
    g.add(m);
    return m;
  }

  /* ============================================================
     PART BUILDERS (assembled-space coordinates, cm)
     ============================================================ */

  function buildLens(g) {
    const x = LENS.x, y = LENS.y;
    // collar seated in the front cover
    cylZ(g, 1.84, 1.88, 0.13, 96, MAT.frame, x, y, 1.69, true);
    torus(g, 1.82, 0.022, MAT.blackGloss, x, y, 1.75, 0, 0, 0, 96);
    // knurled protection ring (thread-on, part of waterproofing)
    cylZ(g, 1.75, 1.78, 0.27, 128, MAT.lensRing, x, y, 1.885, true);
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2;
      box(g, 0.05, 0.042, 0.235, MAT.lensRing,
        x + Math.cos(a) * 1.755, y + Math.sin(a) * 1.755, 1.885, 0, 0, a);
    }
    torus(g, 1.75, 0.018, MAT.blackGloss, x, y, 1.99, 0, 0, 0, 128);
    // flat front face ring around the glass
    add(g, new THREE.RingGeometry(1.5, 1.75, 128), MAT.lensRing, x, y, 2.025);
    torus(g, 1.5, 0.012, MAT.blackGloss, x, y, 2.028, 0, 0, 0, 128);
    // inner stepped barrel (open tubes so the optics stay visible)
    cylZ(g, 1.5, 1.52, 0.12, 96, MAT.blackGloss, x, y, 2.0, true);
    cylZ(g, 1.36, 1.46, 0.16, 96, MAT.frame, x, y, 1.94, true);
    // aperture + coating
    add(g, new THREE.CircleGeometry(1.25, 96), new THREE.MeshBasicMaterial({
      map: T.aperture(), toneMapped: false
    }), x, y, 2.012);
    add(g, new THREE.CircleGeometry(1.08, 96), new THREE.MeshBasicMaterial({
      // additive coating veil: kept below 0.7 so the dark optic still reads as
      // glass instead of washing out into a pale disc under AgX tone mapping
      map: T.lensCoating(), transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }), x, y, 2.022);
    // front glass dome Φ20
    const domeGeo = new THREE.SphereGeometry(1.0, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    domeGeo.rotateX(Math.PI / 2);
    const dome = new THREE.Mesh(domeGeo, MAT.lensGlass);
    dome.position.set(x, y, 2.026);
    dome.scale.set(1, 1, 0.07);
    dome.userData.noGlow = true;
    g.add(dome);
    torus(g, 1.01, 0.014, MAT.blackGloss, x, y, 2.032, 0, 0, 0, 96);
    // eight engraved index marks on the ring face. They used to be 1.3 mm tall
    // black boxes half-buried in the ring, which read as loose black squares;
    // now they are flat, matte and sit 0.065 mm proud of the machined face.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      box(g, 0.05, 0.024, 0.006, MAT.detailDark,
        x + Math.cos(a) * 1.62, y + Math.sin(a) * 1.62, 2.0285, 0, 0, a);
    }
    // red index dot
    add(g, new THREE.CircleGeometry(0.035, 24), MAT.red, x, y + 1.62, 2.032);
    // rear connector pad
    box(g, 1.1, 0.48, 0.07, MAT.gold, x, y - 0.1, 1.6);
  }

  function buildSensor(g) {
    const x = LENS.x, y = LENS.y;
    rbox(g, 2.5, 2.3, 0.14, 0.1, MAT.frame, x, y, 1.2);
    rbox(g, 2.05, 1.95, 0.12, 0.08, MAT.shellDark, x, y, 1.3);
    rbox(g, 1.82, 1.62, 0.13, 0.04, new THREE.MeshStandardMaterial({
      color: 0x2a2f35, metalness: 0.3, roughness: 0.62
    }), x, y, 1.42);
    box(g, 2.0, 0.04, 0.015, MAT.gold, x, y + 0.86, 1.42);
    const sensorMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a1524, metalness: 0.7, roughness: 0.18,
      iridescence: 1, iridescenceIOR: 1.9,
      iridescenceThicknessRange: [120, 480], envMapIntensity: 1.5
    });
    box(g, 1.3, 1.1, 0.035, sensorMat, x, y, 1.5);
    plane(g, 1.1, 0.92, new THREE.MeshBasicMaterial({
      map: T.lensCoating(), transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }), x, y, 1.524);
    rbox(g, 1.1, 0.38, 0.03, 0.04, MAT.copper, x - 0.4, y - 0.95, 1.24, 0, 0, 0.2);
    rbox(g, 0.5, 0.28, 0.07, 0.03, MAT.blackGloss, x - 0.95, y - 1.06, 1.24);
    [[-1.05, 0.85], [1.05, 0.85], [-1.05, -0.85], [1.05, -0.85]].forEach(function (p) {
      screw(g, x + p[0], y + p[1], 1.28, 'front', 0.075);
    });
  }

  function buildFrontCover(g) {
    add(g, shellPlateGeo(W, H, 1.10, 0.1, CORNER), MAT.shell, 0, 0, 1.09);
    // subtle face rim
    // lens recess / collar
    cylZ(g, 1.86, 1.9, 0.07, 96, MAT.frame, LENS.x, LENS.y, 1.655, true);
    torus(g, 1.84, 0.02, MAT.blackGloss, LENS.x, LENS.y, 1.695, 0, 0, 0, 96);
    // front screen recess (dark gasket under the module, 2.5 mm below its trim)
    rbox(g, 2.92, 3.26, 0.05, 0.2, MAT.shellDark, SCR.x, SCR.y, 1.6475);
    rbox(g, 2.8, 3.14, 0.02, 0.18, MAT.blackGloss, SCR.x, SCR.y, 1.68);
    // OSMO ACTION 4 silk print, below the lens (0.065 mm off the shell face)
    plane(g, 3.3, 0.36, MAT.actionLogo, LENS.x, -1.8, 1.6465);
    // small front details: lit recess discs instead of flat black stickers
    add(g, new THREE.CircleGeometry(0.03, 16), new THREE.MeshBasicMaterial({ color: 0x6ff7ff }), -0.9, -1.05, 1.6465);
    add(g, new THREE.CircleGeometry(0.028, 16), MAT.detailDark, -0.1, -1.15, 1.6465);
    add(g, new THREE.CircleGeometry(0.028, 16), MAT.detailDark, 2.1, -1.35, 1.6465);
    add(g, new THREE.CircleGeometry(0.065, 20), MAT.detailDark, 1.2, -1.2, 1.6465);
    // bottom vertical grille (speaker / mic slots) — matte, low-contrast
    for (let i = 0; i < 13; i++) {
      box(g, 0.012, 0.17, 0.008, MAT.grilleDark, 1.4 - 0.9 + i * 0.15, -2.07, 1.6435);
    }
    // inner seal lip
    const sealPts = roundedRectPoints(6.72, 4.1, 0.7, 0.56, 10);
    const sealCurve = new THREE.CatmullRomCurve3(sealPts, true, 'centripetal', 0.4);
    add(g, new THREE.TubeGeometry(sealCurve, 200, 0.03, 10, true), MAT.rubber, 0, 0, 0);
  }

  function buildFrontScreen(g) {
    // metal trim
    rbox(g, 2.9, 3.24, 0.035, 0.2, MAT.frame, SCR.x, SCR.y, 1.66);
    // glossy black module
    rbox(g, 2.78, 3.12, 0.1, 0.18, MAT.screenBezel, SCR.x, SCR.y, 1.69);
    // 320×320 active panel (7.5 µm above the bezel face)
    plane(g, SCR.active, SCR.active, MAT.screenFront, SCR.x, SCR.activeY, 1.7475);
    // cover glass, stacked 3.5 µm above the panel so the two planes never fight
    rbox(g, 2.68, 3.02, 0.018, 0.16, MAT.glass, SCR.x, SCR.y, 1.76).userData.noGlow = true;
    // dji mark lower-left of the module
    plane(g, 0.65, 0.245, MAT.logo, -2.6, -1.18, 1.7705);
    // flex tail (tucked behind the cover, visible once the screen is explodable)
    rbox(g, 0.44, 0.55, 0.022, 0.03, MAT.copper, SCR.x + 0.2, -1.58, 1.61, 0.15, 0, 0);
    rbox(g, 0.26, 0.26, 0.05, 0.02, MAT.rubber, SCR.x + 0.2, -1.74, 1.605);
  }

  function buildMainboard(g) {
    const bx = 1.0, by = 0.0, bz = 0.1;
    const bw = 3.9, bh = 3.2, bd = 0.12;
    add(g, new THREE.BoxGeometry(bw, bh, bd),
      [MAT.pcbEdge, MAT.pcbEdge, MAT.pcbEdge, MAT.pcbEdge, MAT.pcbFace, MAT.pcbEdge],
      bx, by, bz);
    const fz = bz + bd / 2;
    rbox(g, 1.45, 0.85, 0.2, 0.05, MAT.aluminum, bx - 0.85, by + 0.35, fz + 0.1);
    rbox(g, 0.9, 0.72, 0.15, 0.04, MAT.aluminum, bx - 0.8, by - 0.78, fz + 0.075);
    rbox(g, 0.75, 0.75, 0.12, 0.03, MAT.blackGloss, bx + 0.65, by + 0.4, fz + 0.06);
    rbox(g, 0.95, 0.55, 0.1, 0.03, MAT.blackGloss, bx + 0.55, by - 0.48, fz + 0.05);
    rbox(g, 0.68, 0.5, 0.13, 0.03, MAT.aluminum, bx + 1.3, by + 0.92, fz + 0.07);
    [[-0.2, 1.12], [0.08, 1.12], [0.36, 1.12], [-1.7, -0.1], [-1.45, 1.1], [1.5, -1.1], [1.25, -1.2]].forEach(function (p) {
      cylZ(g, 0.065, 0.065, 0.15, 12, MAT.gold, bx + p[0], by + p[1], fz + 0.075);
    });
    rbox(g, 0.55, 0.25, 0.14, 0.03, MAT.whitePlastic, bx - 1.62, by - 1.28, fz + 0.07);
    rbox(g, 0.36, 0.2, 0.12, 0.02, MAT.blackGloss, bx + 1.6, by - 1.3, fz + 0.06);
    rbox(g, 1.25, 0.18, 0.02, 0.02, MAT.copper, bx - 0.4, by + 1.48, bz + 0.01, 0, 0, 0.04);
    rbox(g, 0.8, 0.18, 0.02, 0.02, MAT.copper, bx + 1.4, by - 0.05, bz - 0.08, 0, 0, -0.2);
    const rz = bz - bd / 2;
    rbox(g, 0.8, 0.6, 0.1, 0.03, MAT.blackGloss, bx + 0.35, by - 0.2, rz - 0.05);
    rbox(g, 0.65, 0.4, 0.11, 0.02, MAT.aluminum, bx - 1.1, by + 0.55, rz - 0.055);
    [[-1.65, 1.42], [1.65, 1.42], [-1.65, -1.42], [1.65, -1.42]].forEach(function (p) {
      screw(g, bx + p[0], by + p[1], fz + 0.003, 'front', 0.08);
      cylZ(g, 0.08, 0.08, 0.1, 12, MAT.frame, bx + p[0], by + p[1], bz - 0.1);
    });
  }

  function buildCooling(g) {
    const z = -0.62;
    rbox(g, 3.85, 2.5, 0.035, 0.12, MAT.graphite, 0.95, -0.28, z - 0.08);
    rbox(g, 3.15, 2.0, 0.08, 0.09, MAT.copper, 0.95, -0.26, z);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.35, -0.55, z),
      new THREE.Vector3(0.35, 0.18, z - 0.01),
      new THREE.Vector3(1.15, 0.55, z - 0.01),
      new THREE.Vector3(1.9, 0.1, z - 0.01),
      new THREE.Vector3(2.45, -0.3, z)
    ]);
    add(g, new THREE.TubeGeometry(curve, 96, 0.06, 12, false), MAT.copper, 0, 0, 0);
    for (let i = 0; i < 10; i++) {
      box(g, 0.04, 1.35, 0.46, MAT.aluminum, 0.05 + i * 0.26, -0.28, z - 0.29);
    }
    [[0.15, 0.9], [1.85, 0.9], [0.15, -1.2], [1.85, -1.2]].forEach(function (p) {
      rbox(g, 0.3, 0.26, 0.06, 0.03, MAT.copper, p[0], p[1] - 0.15, z + 0.015);
    });
    rbox(g, 1.0, 0.85, 0.035, 0.03, MAT.shellDark, 0.95, -0.2, z + 0.065);
  }

  function buildBattery(g) {
    const bx = -1.78, by = -0.06, bz = -0.16;
    const bw = 1.24, bh = 3.86, bd = 2.56;
    rbox(g, bw, bh, bd, 0.14, MAT.shellDark, bx, by, bz);
    // label on the outward (-X) face
    const label = new THREE.Mesh(new THREE.PlaneGeometry(bd - 0.14, bh - 0.14), MAT.batteryLabel);
    label.position.set(bx - bw / 2 - 0.008, by, bz);
    label.rotation.y = -Math.PI / 2;
    g.add(label);
    const orange = new THREE.MeshStandardMaterial({ color: 0xf59e2c, metalness: 0.2, roughness: 0.52 });
    box(g, bw + 0.012, 0.05, bd + 0.012, orange, bx, by + bh / 2 - 0.03, bz);
    box(g, bw + 0.012, 0.05, bd + 0.012, orange, bx, by - bh / 2 + 0.03, bz);
    // terminals on the inner (+X) face
    for (let i = 0; i < 3; i++) {
      box(g, 0.035, 0.16, 0.18, MAT.gold, bx + bw / 2 + 0.015, by - 0.28 + i * 0.28, bz - 0.6);
    }
    // BMS strip / pull tab
    rbox(g, 0.03, 0.22, 0.6, 0.02, MAT.blackGloss, bx + bw / 2 + 0.005, by + bh / 2 - 0.35, bz + 0.55);
    rbox(g, 0.4, 0.035, 0.28, 0.02, MAT.rubber, bx, by - bh / 2 - 0.018, bz + 0.72);
    // side rail
    box(g, 0.03, bh - 0.35, 0.03, MAT.frame, bx - bw / 2 - 0.005, by, bz - bd / 2 + 0.12);
  }

  function buildBatteryDoor(g) {
    // large left-side battery door (covers almost the whole side)
    const dx = -HW - 0.015, dy = 0, dz = 0;
    rbox(g, 0.16, 4.1, 2.8, 0.16, MAT.shell, dx, dy, dz);
    rbox(g, 0.06, 3.86, 2.56, 0.13, MAT.shellDark, dx - 0.09, dy, dz);
    // texture ridges (sit on the dark inset panel, not buried inside it)
    for (let i = 0; i < 8; i++) {
      box(g, 0.02, 3.2, 0.03, MAT.graphite, dx - 0.122, dy - 0.1, dz - 0.55 + i * 0.16);
    }
    // unlock button (front-lower area)
    rbox(g, 0.12, 0.55, 0.32, 0.08, MAT.frame, dx - 0.09, dy - 1.28, dz + 0.88);
    for (let i = 0; i < 3; i++) {
      box(g, 0.02, 0.06, 0.24, MAT.blackGloss, dx - 0.15, dy - 1.42 + i * 0.12, dz + 0.88);
    }
    // red waterproof marker on the front edge
    box(g, 0.025, 0.3, 0.13, MAT.red, dx - 0.085, dy - 1.4, dz + 1.32);
    // hinge barrels (rear edge)
    cylY(g, 0.06, 0.06, 0.4, 14, MAT.frame, dx - 0.02, dy + 0.85, dz - 1.27);
    cylY(g, 0.06, 0.06, 0.4, 14, MAT.frame, dx - 0.02, dy - 0.85, dz - 1.27);
    // dji silk print
    plane(g, 0.52, 0.195, MAT.logo, dx - 0.127, dy + 0.2, dz + 0.4, 0, -Math.PI / 2, 0);
    // inner rubber seal
    rbox(g, 0.03, 3.55, 2.35, 0.12, MAT.rubber, dx - 0.055, dy, dz);
    // tiny direction arrow moulded next to the unlock key
    box(g, 0.02, 0.05, 0.22, MAT.blackGloss, dx - 0.095, dy - 1.02, dz + 0.88, 0, 0, 0.0);
    box(g, 0.02, 0.05, 0.14, MAT.blackGloss, dx - 0.095, dy - 1.09, dz + 0.83, 0, 0, 0.7);
  }

  function buildUsbDoor(g) {
    const dx = HW + 0.02, dy = -1.1, dz = -0.6;
    rbox(g, 0.14, 1.3, 1.7, 0.12, MAT.shell, dx, dy, dz);
    rbox(g, 0.05, 1.14, 1.52, 0.1, MAT.shellDark, dx - 0.075, dy, dz);
    // unlock key above the cover
    rbox(g, 0.13, 0.24, 0.44, 0.05, MAT.frame, dx - 0.01, dy + 0.78, dz);
    for (let i = 0; i < 3; i++) {
      box(g, 0.02, 0.2, 0.05, MAT.blackGloss, dx + 0.065, dy + 0.78, dz - 0.13 + i * 0.13);
    }
    // hinge at the rear edge
    cylY(g, 0.05, 0.05, 0.32, 12, MAT.frame, dx, dy + 0.4, dz - 0.83);
    cylY(g, 0.05, 0.05, 0.32, 12, MAT.frame, dx, dy - 0.4, dz - 0.83);
    // rubber seal
    rbox(g, 0.03, 1.1, 1.45, 0.09, MAT.rubber, dx - 0.05, dy, dz);
    // USB icon engraving (three small marks)
    box(g, 0.01, 0.055, 0.055, new THREE.MeshBasicMaterial({ color: 0x5a6269 }), dx + 0.075, dy - 0.12, dz);
    box(g, 0.01, 0.035, 0.2, new THREE.MeshBasicMaterial({ color: 0x5a6269 }), dx + 0.075, dy - 0.12, dz + 0.12);
  }

  function buildRearCover(g) {
    add(g, shellPlateGeo(W, H, 1.10, 0.1, CORNER), MAT.shell, 0, 0, -1.09);
    // screen opening frame
    rbox(g, 5.34, 3.12, 0.05, 0.25, MAT.shellDark, 0, 0, -1.655);
    rbox(g, 5.2, 2.98, 0.025, 0.22, MAT.blackGloss, 0, 0, -1.68);
    // inner EMI shield
    rbox(g, 4.6, 2.6, 0.028, 0.07, MAT.aluminum, 0.15, 0.05, -0.63);
    // status LED II (back top, +X side)
    box(g, 0.24, 0.035, 0.012, new THREE.MeshBasicMaterial({ color: 0x77ffb0, toneMapped: false }), 2.7, 1.8, -1.647);
    // gasket lip
    const sealPts = roundedRectPoints(6.72, 4.1, 0.7, -0.56, 10);
    const sealCurve = new THREE.CatmullRomCurve3(sealPts, true, 'centripetal', 0.4);
    add(g, new THREE.TubeGeometry(sealCurve, 200, 0.03, 10, true), MAT.rubber, 0, 0, 0);
  }

  function buildRearScreen(g) {
    // metal carrier + glossy bezel
    rbox(g, 5.26, 3.04, 0.05, 0.25, MAT.frame, 0, 0, -1.69);
    rbox(g, 5.14, 2.92, 0.1, 0.22, MAT.screenBezel, 0, 0, -1.72);
    // 640×360 active panel (7.5 µm above the bezel face)
    plane(g, 4.99, 2.81, MAT.screenRear, 0, 0, -1.7775, 0, Math.PI, 0);
    // cover glass, stacked 3.5 µm above the panel so the two planes never fight
    rbox(g, 5.02, 2.84, 0.018, 0.2, MAT.glass, 0, 0, -1.79).userData.noGlow = true;
    // FPC tail toward mainboard
    rbox(g, 0.62, 1.9, 0.028, 0.03, MAT.copper, 2.0, -0.2, -1.63, 0.2, 0.25, 0.1);
    rbox(g, 0.3, 0.28, 0.05, 0.02, MAT.blackGloss, 2.08, -1.1, -1.63);
    rbox(g, 4.3, 0.14, 0.02, 0.02, MAT.copper, 0, 1.34, -1.63);
  }

  function buildButtons(g) {
    // shooting button: top, -X side, front edge
    const sx = -1.2, sz = 0.4;
    cylY(g, 0.67, 0.7, 0.08, 64, MAT.frame, sx, HH + 0.04, sz);
    torus(g, 0.55, 0.055, MAT.red, sx, HH + 0.095, sz, Math.PI / 2, 0, 0, 80);
    cylY(g, 0.43, 0.43, 0.22, 64, MAT.blackGloss, sx, HH + 0.19, sz);
    add(g, new THREE.CircleGeometry(0.41, 64), MAT.frame, sx, HH + 0.305, sz, -Math.PI / 2);
    torus(g, 0.26, 0.008, MAT.blackGloss, sx, HH + 0.308, sz, -Math.PI / 2, 0, 0, 64);
    // top speaker: four holes on the lens side, front edge
    for (let i = 0; i < 4; i++) {
      const ox = (i % 2) * 0.18, oz = Math.floor(i / 2) * 0.14;
      add(g, new THREE.CircleGeometry(0.055, 20), MAT.grilleDark, 2.0 + ox, HH + 0.003, 0.98 + oz, -Math.PI / 2, 0, 0);
      torus(g, 0.062, 0.005, MAT.aluminum, 2.0 + ox, HH + 0.004, 0.98 + oz, -Math.PI / 2, 0, 0, 24);
    }
    // QS key: right side, upper, slightly forward
    const qx = HW + 0.055, qy = 0.92, qz = 0.22;
    rbox(g, 0.12, 0.9, 1.1, 0.16, MAT.frame, qx, qy, qz);
    plane(g, 0.3, 0.54, MAT.qsLabel, qx + 0.067, qy, qz, 0, Math.PI / 2, 0);
    // shutter seat plate
    rbox(g, 1.55, 0.035, 1.3, 0.12, MAT.shellDark, sx, HH + 0.004, sz);
    // tiny LED near shutter
    add(g, new THREE.CircleGeometry(0.03, 16), MAT.detailDark, -2.55, HH + 0.003, 0.9, -Math.PI / 2);
  }

  function buildMount(g) {
    // flush magnetic quick-release interface on the bottom
    const my = -HH - 0.1;
    rbox(g, 4.6, 0.18, 2.6, 0.26, MAT.mountMetal, 0, my, 0);
    rbox(g, 4.3, 0.035, 2.3, 0.2, MAT.graphite, 0, my - 0.09, 0);
    // magnetic plate zones (discs sit just proud of the graphite face)
    [[-0.68, -0.55], [0.68, -0.55], [-0.68, 0.55], [0.68, 0.55]].forEach(function (p) {
      cylY(g, 0.38, 0.38, 0.03, 48, MAT.blackGloss, p[0], my - 0.112, p[1]);
      torus(g, 0.3, 0.02, MAT.copper, p[0], my - 0.128, p[1], Math.PI / 2, 0, 0, 64);
    });
    // two quick-release slots at X ≈ ±11 mm
    [-1.1, 1.1].forEach(function (sx) {
      rbox(g, 0.44, 0.06, 1.4, 0.06, MAT.blackGloss, sx, my - 0.1, 0);
      rbox(g, 0.3, 0.09, 1.2, 0.04, MAT.graphite, sx, my - 0.115, 0);
      box(g, 0.05, 0.03, 0.5, MAT.aluminum, sx - 0.16, my - 0.09, 0);
      box(g, 0.05, 0.03, 0.5, MAT.aluminum, sx + 0.16, my - 0.09, 0);
    });
    // tiny screws (internal fastening)
    [[-1.9, -0.95], [1.9, -0.95], [-1.9, 0.95], [1.9, 0.95]].forEach(function (p) {
      screw(g, p[0], my - 0.181, p[1], 'down', 0.075);
    });
  }

  function buildMidframe(g) {
    // top / bottom / right structural walls
    rbox(g, W - 0.1, 0.4, 0.92, 0.1, MAT.frame, 0, HH - 0.2, 0);
    rbox(g, W - 0.1, 0.4, 0.92, 0.1, MAT.frame, 0, -HH + 0.2, 0);
    rbox(g, 0.4, H - 0.72, 0.92, 0.1, MAT.frame, HW - 0.2, 0, 0);
    // left side: open battery bay framed by thin strips (door covers it)
    rbox(g, 0.3, 4.15, 0.16, 0.06, MAT.frame, -HW + 0.15, 0, 1.4);
    rbox(g, 0.3, 4.15, 0.16, 0.06, MAT.frame, -HW + 0.15, 0, -1.4);
    rbox(g, 0.3, 0.16, 2.8, 0.06, MAT.frame, -HW + 0.15, 2.03, 0);
    rbox(g, 0.3, 0.16, 2.8, 0.06, MAT.frame, -HW + 0.15, -2.03, 0);
    // battery bay liner + divider
    box(g, 0.08, 3.5, 2.3, MAT.shellDark, -1.02, 0, -0.2);
    box(g, 2.2, 0.06, 2.3, MAT.shellDark, -2.2, 1.94, -0.2);
    box(g, 2.2, 0.06, 2.3, MAT.shellDark, -2.2, -1.94, -0.2);
    box(g, 2.2, 3.5, 0.06, MAT.shellDark, -2.2, 0, 1.08);
    box(g, 2.2, 3.5, 0.06, MAT.shellDark, -2.2, 0, -1.48);
    // battery contacts inside the bay
    for (let i = 0; i < 3; i++) {
      box(g, 0.03, 0.14, 0.16, MAT.gold, -0.99, -0.28 + i * 0.28, -0.76);
    }
    // microSD slot, inside the battery door
    rbox(g, 0.06, 0.08, 0.58, 0.02, MAT.blackGloss, -2.9, 1.3, -0.9);
    box(g, 0.02, 0.025, 0.36, MAT.aluminum, -2.93, 1.3, -0.9);
    // screw bosses / structural rails
    [[-2.7, 1.5], [2.7, 1.5], [-2.7, -1.5], [2.7, -1.5]].forEach(function (p) {
      cylZ(g, 0.15, 0.17, 0.9, 16, MAT.frame, p[0], p[1], 0);
      cylZ(g, 0.07, 0.07, 0.94, 10, MAT.blackGloss, p[0], p[1], 0);
    });
    box(g, 0.14, 2.9, 0.42, MAT.frame, 0.1, 0, -0.18);
    box(g, 0.14, 2.9, 0.42, MAT.frame, 2.5, 0, -0.18);
    box(g, 3.2, 0.12, 0.3, MAT.frame, 1.6, -1.65, -0.18);
    // USB-C port inside the right-side cover
    rbox(g, 0.06, 0.26, 0.86, 0.1, MAT.blackGloss, HW + 0.005, -1.1, -0.6);
    rbox(g, 0.04, 0.17, 0.66, 0.07, MAT.aluminum, HW + 0.035, -1.1, -0.6);
    box(g, 0.02, 0.055, 0.45, MAT.blackGloss, HW + 0.065, -1.1, -0.6);
    for (let i = 0; i < 6; i++) {
      box(g, 0.01, 0.012, 0.03, MAT.gold, HW + 0.069, -1.1, -0.78 + i * 0.07);
    }
    // inner shield sheet
    rbox(g, 4.5, 2.7, 0.02, 0.08, MAT.graphite, 0.8, 0.05, -0.27);
    // front and rear seal rings
    [0.56, -0.56].forEach(function (z) {
      const pts = roundedRectPoints(6.6, 4.0, 0.72, z, 10);
      const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.4);
      add(g, new THREE.TubeGeometry(curve, 200, 0.038, 10, true), MAT.rubber, 0, 0, 0);
    });
    // bottom anti-wind mic housing
    add(g, new THREE.CircleGeometry(0.05, 12), MAT.blackGloss, -2.55, -HH - 0.001, 0.62, Math.PI / 2, 0, 0);
  }

  const BUILDERS = {
    lens: buildLens,
    sensor: buildSensor,
    frontCover: buildFrontCover,
    frontScreen: buildFrontScreen,
    mainboard: buildMainboard,
    cooling: buildCooling,
    battery: buildBattery,
    batteryDoor: buildBatteryDoor,
    usbDoor: buildUsbDoor,
    rearCover: buildRearCover,
    rearScreen: buildRearScreen,
    buttons: buildButtons,
    mount: buildMount,
    midframe: buildMidframe
  };

  /* ---------- registration ---------- */
  function registerPart(root, meta, content, parts, pickables) {
    content.updateMatrixWorld(true);
    const box3 = new THREE.Box3().setFromObject(content);
    const center = box3.getCenter(new THREE.Vector3());
    const size = box3.getSize(new THREE.Vector3());

    content.children.forEach(function (child) {
      child.position.sub(center);
    });

    const pivot = new THREE.Group();
    pivot.name = 'part-' + meta.id;
    pivot.position.copy(center);
    pivot.add(content);
    root.add(pivot);

    const glowMats = [];
    const seenMats = new Set();
    content.traverse(function (o) {
      if (!o.isMesh) return;
      o.userData.partId = meta.id;
      o.material = Array.isArray(o.material)
        ? o.material.map(function (m) { return m.clone(); })
        : o.material.clone();
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(function (m) {
        if (seenMats.has(m.uuid)) return;
        seenMats.add(m.uuid);
        if (m.emissive && !o.userData.noGlow) {
          m.userData.baseEmissive = m.emissive.clone();
          m.userData.baseEmissiveIntensity = m.emissiveIntensity;
          glowMats.push(m);
        }
      });
      pickables.push(o);
    });

    const anchor = new THREE.Object3D();
    const abs = meta.anchorAbs || [center.x, center.y + size.y * 0.35, center.z];
    anchor.position.set(abs[0] - center.x, abs[1] - center.y, abs[2] - center.z);
    content.add(anchor);

    const part = {
      id: meta.id,
      meta: meta,
      pivot: pivot,
      content: content,
      center: center.clone(),
      size: size.clone(),
      anchor: anchor,
      glowMats: glowMats
    };
    parts.push(part);
    return part;
  }

  /* ---------- public API ---------- */
  function createModel() {
    MAT = makeMaterials();
    const root = new THREE.Group();
    root.name = 'OsmoAction4';
    const parts = [];
    const pickables = [];
    META.forEach(function (meta) {
      const content = new THREE.Group();
      content.name = 'content-' + meta.id;
      BUILDERS[meta.id](content);
      const part = registerPart(root, meta, content, parts, pickables);
      part.index = String(parts.length).padStart(2, '0');
    });
    const byId = {};
    parts.forEach(function (p) { byId[p.id] = p; });

    return {
      root: root,
      parts: parts,
      byId: byId,
      pickables: pickables,
      materials: MAT,
      dimensions: { w: W, h: H, d: D },
      floorY: -5.3,
      deviceY: 0.9
    };
  }

  window.DJI.createModel = createModel;
})();
