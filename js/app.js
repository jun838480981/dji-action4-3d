/* ============================================================
   app.js — scene, lighting, camera, explosion animation and UI
   ============================================================ */
(function () {
  'use strict';

  const B = window.THREE_BUNDLE;
  const THREE = B.THREE;
  const OrbitControls = B.OrbitControls;
  const EffectComposer = B.EffectComposer;
  const RenderPass = B.RenderPass;
  const UnrealBloomPass = B.UnrealBloomPass;
  const OutputPass = B.OutputPass;
  const T = window.DJI.textures;

  const $ = function (id) { return document.getElementById(id); };
  const clamp = THREE.MathUtils.clamp;
  const deg = THREE.MathUtils.degToRad;

  const DEFAULT_POSE = { az: 0.58, el: 0.24, r: 13.8, ty: 0.6 };
  const EXPLODED_POSE = { az: 0.84, el: 0.28, r: 23.5, ty: 0.5, tx: -0.2 };
  const INTRO_POSE = { az: 1.05, el: 0.42, r: 23.5, ty: 0.7 };
  const MOBILE_DEFAULT_POSE = { az: 0.58, el: 0.22, r: 18.8, ty: 0.6 };
  const MOBILE_EXPLODED_POSE = { az: 0.84, el: 0.28, r: 30.5, ty: 0.5, tx: -0.2 };
  const MOBILE_INTRO_POSE = { az: 1.05, el: 0.38, r: 25.5, ty: 0.7 };
  const MOBILE_BREAKPOINT = 960;

  /* ============================================================
     render quality tiers
     ------------------------------------------------------------
     The whole scene is drawn through EffectComposer, i.e. into an
     offscreen WebGLRenderTarget — the canvas `antialias` flag therefore
     never reaches the actual scene pixels. Proper anti-aliasing has to
     come from MSAA samples on the composer target instead, which is the
     single biggest image-quality lever here.
     Every tier bundles the knobs that actually trade looks for GPU cost.
     ============================================================ */
  const QUALITY_TIERS = [
    { name: 'low',    label: '流畅', samples: 0, dprCap: 1.0, shadowOn: false, shadowMap: 512,  bloomScale: 0.5,  bloomEnabled: false },
    { name: 'medium', label: '均衡', samples: 2, dprCap: 1.5, shadowOn: true,  shadowMap: 1024, bloomScale: 0.5,  bloomEnabled: true },
    { name: 'high',   label: '精细', samples: 4, dprCap: 2.0, shadowOn: true,  shadowMap: 2048, bloomScale: 0.6,  bloomEnabled: true }
  ];
  const QUALITY_INDEX = { low: 0, medium: 1, high: 2 };
  const TIER_HIGH = 2;
  const TIER_MEDIUM = 1;

  const state = {
    exploded: false,
    explodeVisual: 0,
    explodeStart: performance.now(),
    explodeFrom: 0,
    selected: null,
    hovered: null,
    labelsOn: true,
    autoFocus: true,
    autoRotate: false,
    tab: 'detail',
    intro: true,
    ready: false,
    mobile: window.innerWidth <= MOBILE_BREAKPOINT,
    dragging: false,
    qualityTier: TIER_HIGH,
    qualityCooldown: 0,
    qualityDowngraded: false,
    frameTimeAvg: 0,
    tierSwitchAt: 0
  };

  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let composer = null;
  let bloomPass = null;
  let ditherPass = null;
  let keyLight = null;
  let model = null;
  let clock = null;
  let raycaster = null;
  let pointerNDC = null;
  let animFrame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let camTween = null;
  let bootHidden = false;
  let toastTimer = 0;
  let lastMeterPct = -1;
  let hoverPickAt = 0;
  let pendingPointer = null;
  let hoverRaf = 0;
  let pointerDown = null;
  let labelEls = {};
  let labelCacheW = 0;
  let introFlyTimer = 0;
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const customColors = {};

  const dom = {};

  function cacheDom() {
    [
      'scene', 'boot', 'bootBar', 'bootStatus', 'fallback', 'statusCode', 'statusMeta',
      'btnGuide', 'btnFullscreen', 'btnMobileParts', 'btnMobileInfo', 'panelParts',
      'partList', 'partCount', 'panelInfo', 'infoBody', 'explodePct', 'explodeMeter',
      'btnCloseInfo', 'btnFocusSelected', 'labelsLayer', 'leaderSvg', 'labelNodes',
      'hoverTag', 'hoverIndex', 'hoverName', 'btnExplode', 'explodeLabel', 'btnReset',
      'btnAutoRotate', 'btnLabels', 'btnFocusCam', 'toast', 'guideModal', 'tabUnderline',
      'dock'
    ].forEach(function (id) { dom[id] = $(id); });
    dom.tabs = Array.prototype.slice.call(document.querySelectorAll('.info-tab'));
    dom.closeGuide = Array.prototype.slice.call(document.querySelectorAll('[data-close="guide"]'));
    dom.guideOpeners = [dom.btnGuide];
  }

  /* ============================================================
     boot helpers
     ============================================================ */
  function boot(pct, text) {
    if (dom.bootBar) dom.bootBar.style.width = pct + '%';
    if (dom.bootStatus && text) dom.bootStatus.textContent = text;
  }
  function hideBoot() {
    if (bootHidden) return;
    bootHidden = true;
    boot(100, '系统就绪');
    setTimeout(function () {
      if (dom.boot) dom.boot.classList.add('is-done');
      afterBoot();
    }, 520);
  }
  function afterBoot() {
    state.ready = true;
    flyToPose(getDefaultPose(), 2.2);
    setTimeout(function () {
      if (!state.selected) showToast('点击任意部件开始拆解 · 拖拽旋转视角', 5200);
    }, 1000);
  }
  function showFallback(message) {
    if (dom.boot) dom.boot.classList.add('is-done');
    dom.fallback.hidden = false;
    if (message) {
      const p = dom.fallback.querySelector('.fallback-tip');
      if (p) p.textContent = '错误信息：' + message;
    }
  }

  /* ============================================================
     adaptive quality
     ============================================================ */
  function currentTier() {
    return QUALITY_TIERS[state.qualityTier] || QUALITY_TIERS[TIER_HIGH];
  }

  function detectQualityTier() {
    if (state.mobile) return TIER_MEDIUM;
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 4;
    const maxSamples = (renderer && renderer.capabilities && renderer.capabilities.maxSamples) || 0;
    const fillPx = window.innerWidth * window.innerHeight * dpr * dpr;
    // retina laptops / 4k canvases already push a lot of pixels; start one
    // tier lower so the first seconds of interaction stay smooth.
    if (maxSamples < 4 || cores <= 4 || fillPx > 6.2e6) return TIER_MEDIUM;
    return TIER_HIGH;
  }

  function applyQuality(index, opts) {
    opts = opts || {};
    const prevIndex = state.qualityTier;
    state.qualityTier = clamp(index | 0, 0, QUALITY_TIERS.length - 1);
    const tier = currentTier();
    const changed = prevIndex !== state.qualityTier;

    if (renderer) {
      const dpr = Math.min(window.devicePixelRatio || 1, tier.dprCap);
      renderer.setPixelRatio(dpr);
      renderer.shadowMap.enabled = tier.shadowOn;
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
    if (keyLight) {
      keyLight.castShadow = tier.shadowOn;
      if (keyLight.shadow) {
        keyLight.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
        if (keyLight.shadow.map) {
          keyLight.shadow.map.dispose();
          keyLight.shadow.map = null;
        }
      }
    }
    if (stage.shadow && stage.shadow.material) {
      // the baked contact blob keeps its strength; real shadows only add the
      // directional/self-shadowing part (see animate())
      stage.shadow.material.opacity = 0.5;
    }
    if (stage.shadowCatcher) stage.shadowCatcher.visible = tier.shadowOn;
    if (bloomPass) bloomPass.enabled = tier.bloomEnabled;

    if (composer) rebuildComposerTarget();
    state.tierSwitchAt = performance.now();
    if (changed && !opts.silent) {
      showToast('画质：' + tier.label, 1800);
    }
    if (!opts.boot && changed) state.qualityDowngraded = state.qualityTier < prevIndex;
    return tier;
  }

  /* ============================================================
     renderer / scene / environment
     ============================================================ */
  function initRenderer() {
    const canvas = dom.scene;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        // Canvas-level MSAA is useless here: every frame is drawn into the
        // composer's render target, so anti-aliasing must live on that target.
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true
      });
    } catch (err) {
      showFallback(err && err.message ? err.message : 'WebGL 初始化失败');
      throw err;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // AgX keeps far more colour separation in the mid-tones than ACES, which
    // turned the matte shell into flat grey. Exposure is raised to compensate
    // for AgX's slightly darker response.
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // accumulate draw / triangle counters across all composer passes
    renderer.info.autoReset = false;

    state.qualityTier = detectQualityTier();
    // the procedural texture factory reads this before generating canvases
    window.DJI = window.DJI || {};
    window.DJI.textureAnisotropy = renderer.capabilities.getMaxAnisotropy();

    applyQuality(state.qualityTier, { silent: true, boot: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04070d);
    scene.fog = new THREE.FogExp2(0x04070d, 0.0125);

    camera = new THREE.PerspectiveCamera(state.mobile ? 50 : 38, window.innerWidth / window.innerHeight, 0.1, 220);
    const introPose = state.mobile ? MOBILE_INTRO_POSE : INTRO_POSE;
    const p = sphericalToVec(introPose.az, introPose.el, introPose.r, introPose.ty, new THREE.Vector3());
    camera.position.copy(p);
    camera.lookAt(0, introPose.ty, 0);

    clock = new THREE.Clock();
    lastTime = performance.now();
    raycaster = new THREE.Raycaster();
    pointerNDC = new THREE.Vector2(0, 0);
  }

  function initEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();

    // ---- gradient sky dome -----------------------------------------
    // The previous environment was a flat dark box, so every metal surface
    // reflected one single grey value and read as plastic. A soft vertical
    // gradient plus a compressed bright band at the horizon gives anodised
    // aluminium and black glass a believable reflection structure.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(30, 48, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: [
          'varying vec3 vDir;',
          'void main(){',
          '  vDir = normalize(position);',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: [
          'precision highp float;',
          'varying vec3 vDir;',
          'void main(){',
          '  float y = vDir.y;',
          '  vec3 ground  = vec3(0.004, 0.006, 0.009);',
          '  vec3 horizon = vec3(0.034, 0.055, 0.078);',
          '  vec3 zenith  = vec3(0.010, 0.020, 0.036);',
          '  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.68, y));',
          '  col = mix(ground, col, smoothstep(-0.46, 0.02, y));',
          '  float band = exp(-pow((y - 0.015) / 0.06, 2.0));',
          '  col += vec3(0.115, 0.165, 0.215) * band;',
          '  col += vec3(0.030, 0.036, 0.046) * smoothstep(0.15, 1.0, y);',
          '  gl_FragColor = vec4(col, 1.0);',
          '}'
        ].join('\n')
      })
    );
    envScene.add(sky);

    function panel(w, h, rgb, pos, rotX) {
      const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
      mat.color.setRGB(rgb[0], rgb[1], rgb[2]);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.lookAt(0, 0, 0);
      if (rotX) mesh.rotation.set(rotX, 0, 0);
      envScene.add(mesh);
      return mesh;
    }

    // large soft box above (main specular source)
    panel(17, 13, [5.2, 5.0, 4.7], [0, 16, 2]);
    // neutral key front
    panel(12, 8, [2.8, 3.0, 3.2], [2, 5, 14]);
    // cool rim left
    panel(9, 5, [0.32, 2.15, 3.1], [-13, 5, 3]);
    // subtle warm rim right/back
    panel(7, 4, [1.9, 1.0, 0.5], [12, 1, -6]);
    // cyan back strip
    panel(5, 9, [0.32, 1.75, 2.7], [-1, 3, -14]);
    // low front-left fill (lifts the bottom faces)
    panel(7, 3.5, [0.45, 1.15, 1.7], [-9, -2.5, 8]);
    // faint floor bounce
    panel(20, 20, [0.30, 0.42, 0.56], [0, -10, 0], -Math.PI / 2);

    const envRT = pmrem.fromScene(envScene, 0.022);
    scene.environment = envRT.texture;
    if ('environmentIntensity' in scene) scene.environmentIntensity = 1.0;

    envScene.traverse(function (o) {
      if (o.isMesh) {
        o.geometry.dispose();
        if (o.material) o.material.dispose();
      }
    });
    pmrem.dispose();
  }

  function initLights() {
    scene.add(new THREE.HemisphereLight(0x6fa8c8, 0x02050a, 0.5));

    // key light doubles as the only shadow caster: a single well-tuned soft
    // shadow is enough to ground the floating body and let parts occlude
    // each other, which is what makes the exploded view readable.
    const key = new THREE.DirectionalLight(0xfff4e8, 2.35);
    key.position.set(7, 10, 9);
    key.castShadow = true;
    const tier = currentTier();
    key.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 46;
    key.shadow.camera.left = -11;
    key.shadow.camera.right = 11;
    key.shadow.camera.top = 11;
    key.shadow.camera.bottom = -11;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.028;
    key.shadow.camera.updateProjectionMatrix();
    scene.add(key);
    keyLight = key;

    const fill = new THREE.DirectionalLight(0x7fc9ff, 1.45);
    fill.position.set(-10, 3, 7);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0x62e9ff, 2.05);
    rim.position.set(-4, 6, -10);
    scene.add(rim);

    const warm = new THREE.DirectionalLight(0xffa46a, 0.9);
    warm.position.set(9, 1, -7);
    scene.add(warm);

    const bottomGlow = new THREE.PointLight(0x21c7e8, 12, 18, 2);
    bottomGlow.position.set(0, -4.4, 2.2);
    scene.add(bottomGlow);

    const lensGlow = new THREE.PointLight(0x9ae8ff, 7, 8, 2);
    lensGlow.position.set(-1.6, 0.4, 5.2);
    scene.add(lensGlow);
  }

  /* ============================================================
     stage: floor grid, rings, particles
     ============================================================ */
  const stage = {};

  function initStage() {
    const floorY = (model && model.floorY) || -5.3;

    // radial tech grid
    const gridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0x3ed8ff) },
        uTime: { value: 0 }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'varying vec2 vUv;',
        'uniform vec3 uColor;',
        'uniform float uTime;',
        'float gridLine(vec2 uv, float scale){',
        '  vec2 g = abs(fract(uv * scale - 0.5) - 0.5) / fwidth(uv * scale);',
        '  return 1.0 - min(min(g.x, g.y), 1.0);',
        '}',
        'void main(){',
        '  vec2 p = vUv * 2.0 - 1.0;',
        '  float d = length(p);',
        '  float fade = smoothstep(1.0, 0.12, d);',
        '  float g1 = gridLine(vUv, 22.0);',
        '  float g2 = gridLine(vUv, 110.0);',
        '  float pulse = 0.78 + 0.22 * sin(uTime * 1.1 - d * 9.0);',
        '  vec3 col = uColor * (g1 * 0.22 + g2 * 0.055) * fade * pulse;',
        '  float alpha = (g1 * 0.34 + g2 * 0.09) * fade;',
        '  gl_FragColor = vec4(col, alpha);',
        '}'
      ].join('\n')
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = floorY + 0.005;
    grid.renderOrder = 1;
    scene.add(grid);
    stage.grid = grid;
    stage.gridMat = gridMat;

    // glow disc
    const glowMat = new THREE.MeshBasicMaterial({
      map: T.floorGlow(), transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = floorY + 0.012;
    glow.renderOrder = 2;
    scene.add(glow);
    stage.glow = glow;

    // soft shadow under the floating camera
    const shadowMat = new THREE.MeshBasicMaterial({
      map: T.shadow(), transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = floorY + 0.02;
    shadow.renderOrder = 3;
    scene.add(shadow);
    stage.shadow = shadow;

    // real PCF-soft shadow catcher: the baked blob above stays as ambient
    // contact darkening, while this plane receives the directional shadow
    // (which also makes the exploded parts feel grounded).
    const catcherMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.4, depthWrite: false });
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(36, 36), catcherMat);
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = floorY + 0.026;
    catcher.renderOrder = 6;
    catcher.receiveShadow = true;
    catcher.visible = currentTier().shadowOn;
    scene.add(catcher);
    stage.shadowCatcher = catcher;

    // concentric rings on the floor
    const ringGroup = new THREE.Group();
    [3.2, 4.35, 5.35].forEach(function (r, i) {
      const mat = new THREE.MeshBasicMaterial({
        color: i === 0 ? 0x7defff : 0x2ea9c9, transparent: true,
        opacity: [0.22, 0.13, 0.08][i], blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.012, 160), mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = floorY + 0.03;
      ring.renderOrder = 4;
      ringGroup.add(ring);
    });
    scene.add(ringGroup);
    stage.floorRings = ringGroup;

    // HUD halo rings around the floating camera
    const hud = new THREE.Group();
    hud.position.y = 0.75;
    const ringMatA = new THREE.MeshBasicMaterial({
      color: 0x55e5ff, transparent: true, opacity: 0.065,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    });
    const ringMatB = new THREE.MeshBasicMaterial({
      color: 0x9ad9ff, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false
    });
    const flatRing = new THREE.Mesh(new THREE.RingGeometry(5.15, 5.17, 200), ringMatA);
    flatRing.rotation.x = -Math.PI / 2;
    hud.add(flatRing);

    const arc1 = new THREE.Mesh(new THREE.RingGeometry(4.55, 4.6, 120, 1, 0.4, 1.1), ringMatA);
    arc1.rotation.x = -Math.PI / 2;
    hud.add(arc1);

    const vRing1 = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.009, 6, 220), ringMatB);
    vRing1.rotation.set(0.35, 0.2, 0.25);
    hud.add(vRing1);

    const vRing2 = new THREE.Mesh(new THREE.TorusGeometry(6.4, 0.008, 6, 220), ringMatB);
    vRing2.rotation.set(-0.4, 0.9, 0.15);
    hud.add(vRing2);

    // tick marks
    const tickPositions = [];
    const tickRadius = 5.35;
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const len = i % 15 === 0 ? 0.34 : (i % 5 === 0 ? 0.18 : 0.09);
      tickPositions.push(
        Math.cos(a) * tickRadius, 0, Math.sin(a) * tickRadius,
        Math.cos(a) * (tickRadius + len), 0, Math.sin(a) * (tickRadius + len)
      );
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPositions, 3));
    const ticks = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: 0x6fe6ff, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    hud.add(ticks);
    scene.add(hud);
    stage.hud = hud;

    // ambient backdrop sprites
    function bgSprite(color, opacity, scale, pos) {
      const mat = new THREE.SpriteMaterial({
        map: T.softGlow(), color: color, transparent: true, opacity: opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      const s = new THREE.Sprite(mat);
      s.position.set(pos[0], pos[1], pos[2]);
      s.scale.set(scale, scale, 1);
      scene.add(s);
      return s;
    }
    stage.backA = bgSprite(0x1b7e9c, 0.22, 20, [-7, 2.5, -13]);
    stage.backB = bgSprite(0x8c3a63, 0.12, 15, [9, -1, -14]);

    // dust particles
    stage.dust = buildParticles(700, 9, 30, 0x74ddff, 0.09, 0.7);
    stage.dustBig = buildParticles(90, 7, 22, 0xffc37a, 0.2, 0.4);
    scene.add(stage.dust);
    scene.add(stage.dustBig);
  }

  function buildParticles(count, rMin, rMax, color, size, opacity) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = rMin + Math.random() * (rMax - rMin);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi) * 0.55;
      const z = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: size, map: T.particle(), transparent: true, opacity: opacity,
      color: color, blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: true, toneMapped: false
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }

  /* ============================================================
     model + halo / selection effects
     ============================================================ */
  const halos = {};

  function initModel() {
    boot(45, '装配机身中框与外壳…');
    model = window.DJI.createModel();
    model.root.position.y = model.deviceY;
    scene.add(model.root);

    // Shadow flags: solid shells cast and receive, while flat silk-prints /
    // screen faces and see-through glass stay out of the shadow pass — they
    // would only add acne or dark fringes.
    model.root.traverse(function (o) {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const type = (geo && geo.type) || '';
      const flat = type === 'PlaneGeometry' || type === 'CircleGeometry' || type === 'RingGeometry';
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const decorative = mats.some(function (m) {
        return !!m && ((m.transparent && m.opacity < 0.9) || (m.alphaTest && m.alphaTest > 0.01));
      });
      o.castShadow = !flat && !decorative;
      o.receiveShadow = !flat && !decorative;
    });

    const spotLight = new THREE.PointLight(0x4fe3ff, 4, 9, 2);
    spotLight.position.set(0, 1.2, 3.2);
    scene.add(spotLight);

    model.parts.forEach(function (part) {
      const meta = part.meta;
      const color = new THREE.Color(meta.accent);
      customColors[part.id] = color;

      const haloMat = new THREE.SpriteMaterial({
        map: T.softGlow(), color: color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false
      });
      const halo = new THREE.Sprite(haloMat);
      halo.visible = false;
      scene.add(halo);

      const ringMat = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
        side: THREE.DoubleSide, toneMapped: false
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 72), ringMat);
      ring.visible = false;
      scene.add(ring);

      part.glow = 0;
      part.glowTarget = 0;
      halos[part.id] = { halo: halo, ring: ring, haloMat: haloMat, ringMat: ringMat };
    });
  }

  /* ============================================================
     camera / controls
     ============================================================ */
  function initControls() {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.6, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.rotateSpeed = 0.62;
    controls.zoomSpeed = 0.72;
    controls.panSpeed = 0.5;
    controls.screenSpacePanning = true;
    controls.minDistance = 6.2;
    controls.maxDistance = state.mobile ? 64 : 34;
    controls.minPolarAngle = 0.1;
    controls.maxPolarAngle = Math.PI - 0.1;
    controls.autoRotateSpeed = 0.52;
    controls.enablePan = true;
    controls.addEventListener('start', function () {
      camTween = null;
      state.dragging = true;
      hideHover();
    });
    controls.addEventListener('end', function () {
      state.dragging = false;
    });
    controls.update();
  }

  function sphericalToVec(az, el, r, ty, out) {
    out = out || new THREE.Vector3();
    const ce = Math.cos(el);
    out.set(
      Math.sin(az) * ce * r,
      (ty || 0) + Math.sin(el) * r,
      Math.cos(az) * ce * r
    );
    return out;
  }

  function getDefaultPose() {
    return state.mobile ? MOBILE_DEFAULT_POSE : DEFAULT_POSE;
  }
  function getExplodedPose() {
    return state.mobile ? MOBILE_EXPLODED_POSE : EXPLODED_POSE;
  }

  function poseToPosition(pose, out) {
    out = out || new THREE.Vector3();
    const ty = pose.ty === undefined ? 0.6 : pose.ty;
    sphericalToVec(pose.az, pose.el, pose.r, 0, out);
    out.x += pose.tx || 0;
    out.z += pose.tz || 0;
    out.y = ty + Math.sin(pose.el) * pose.r;
    return out;
  }

  function flyToPose(pose, duration) {
    if (!controls || !camera) return;
    const dur = (duration === undefined ? 1.15 : duration) * 1000;
    const toPos = poseToPosition(pose, new THREE.Vector3());
    const floorY = model ? model.floorY : -5.3;
    if (!pose.ignoreFloor && toPos.y < floorY + 1.4) {
      toPos.y = floorY + 1.4;
    }
    camTween = {
      start: performance.now(),
      dur: Math.max(240, dur),
      fromPos: camera.position.clone(),
      toPos: toPos,
      fromTarget: controls.target.clone(),
      toTarget: new THREE.Vector3(pose.tx || 0, pose.ty === undefined ? 0.6 : pose.ty, pose.tz || 0)
    };
  }

  function updateCameraTween(now) {
    if (!camTween) return;
    const t = clamp((now - camTween.start) / camTween.dur, 0, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    camera.lookAt(controls.target);
    if (t >= 1) camTween = null;
  }

  function focusPart(part) {
    if (!part) return;
    const targetLocal = explodedPoseFor(part, part.id).pos;
    const extent = Math.max(part.size.x, part.size.y, part.size.z);
    let view = part.meta.view;
    if (part.id === 'mount') {
      // look up at the quick-release slots from below the floating stage
      flyToPose({
        az: 0.42,
        el: -0.52,
        r: 11.2,
        tx: targetLocal.x,
        ty: targetLocal.y + model.root.position.y,
        tz: targetLocal.z,
        ignoreFloor: true
      }, 1.25);
      return;
    }
    const radius = clamp(extent * 2.27 + 4.1, 8.0, 14.2) * (state.mobile ? 1.28 : 1);
    const pose = {
      az: view.az,
      el: view.el,
      r: radius,
      tx: targetLocal.x,
      ty: targetLocal.y + model.root.position.y,
      tz: targetLocal.z
    };
    flyToPose(pose, 1.25);
  }

  /* ============================================================
     part animation / selection
     ============================================================ */
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function animatePart(part, targetPos, targetQuat, duration, delay, ease) {
    part.anim = {
      fromPos: part.pivot.position.clone(),
      toPos: targetPos.clone(),
      fromQuat: part.pivot.quaternion.clone(),
      toQuat: targetQuat.clone(),
      start: performance.now() + (delay || 0) * 1000,
      duration: Math.max(80, (duration || 0.9) * 1000),
      ease: ease || easeOutCubic
    };
  }

  function updatePartAnims(now) {
    if (!model) return;
    model.parts.forEach(function (part) {
      const a = part.anim;
      if (!a) return;
      if (now < a.start) return;
      const raw = clamp((now - a.start) / a.duration, 0, 1);
      const k = a.ease(raw);
      part.pivot.position.lerpVectors(a.fromPos, a.toPos, k);
      part.pivot.quaternion.slerpQuaternions(a.fromQuat, a.toQuat, k);
      if (raw >= 1) part.anim = null;
    });
  }

  function explodedPoseFor(part, selectedId) {
    const meta = part.meta;
    const off = new THREE.Vector3(meta.explode[0], meta.explode[1], meta.explode[2]);
    const selected = selectedId === part.id;
    if (selected) {
      if (off.lengthSq() > 0.001) {
        off.add(off.clone().normalize().multiplyScalar(0.95));
      } else {
        off.set(0, 0.55, 0.85);
      }
    }
    const pos = part.center.clone().add(off);
    const mult = selected ? 1.16 : 1;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      deg(meta.explodeRot[0] * mult),
      deg(meta.explodeRot[1] * mult),
      deg(meta.explodeRot[2] * mult)
    ));
    return { pos: pos, quat: q };
  }

  function setExploded(on, opts) {
    opts = opts || {};
    if (!model) return;
    if (state.exploded === on && !opts.force) return;
    state.exploded = on;
    state.explodeFrom = state.explodeVisual;
    state.explodeStart = performance.now();
    const selectedId = on ? state.selected : null;
    const stagger = on ? 0.028 : 0.022;
    const duration = on ? 1.05 : 0.9;
    model.parts.forEach(function (part, i) {
      const target = on
        ? explodedPoseFor(part, selectedId)
        : { pos: part.center.clone(), quat: new THREE.Quaternion() };
      animatePart(part, target.pos, target.quat, duration, i * stagger, on ? easeOutCubic : easeInOutCubic);
    });
    if (!on) {
      state.selected = null;
      updateSelectionUI();
      hideAllLabels();
      updateStatusMeta();
    }
    updateExplodeButton();
    if (opts.fly !== false) {
      flyToPose(on ? getExplodedPose() : getDefaultPose(), on ? 1.35 : 1.15);
    }
    if (!opts.silent) {
      showToast(on ? '拆解完成 · 点击任意部件查看详情' : '已重新组装 · 点击部件再次拆解', 2600);
    }
  }

  function selectPart(id) {
    if (!model) return;
    const part = model.byId[id];
    if (!part) return;
    hideHover();
    if (state.selected === id) {
      if (state.exploded) { deselect(); return; }
    }
    const prev = state.selected;
    state.selected = id;
    if (!state.exploded) {
      setExploded(true, { fly: false, silent: true });
    } else {
      if (prev && model.byId[prev]) {
        const oldPart = model.byId[prev];
        const oldTarget = explodedPoseFor(oldPart, id);
        animatePart(oldPart, oldTarget.pos, oldTarget.quat, 0.55, 0, easeOutCubic);
      }
      const target = explodedPoseFor(part, id);
      animatePart(part, target.pos, target.quat, 0.55, 0, easeOutCubic);
    }
    updateSelectionUI();
    updateStatusMeta();
    if (state.autoFocus) focusPart(part);
    if (state.mobile) openMobilePanel('info');
    showToast(part.index + ' · ' + part.meta.name + ' 已选中', 1800);
  }

  function deselect() {
    if (!state.selected) return;
    const prev = state.selected;
    state.selected = null;
    if (state.exploded && model.byId[prev]) {
      const part = model.byId[prev];
      const target = explodedPoseFor(part, null);
      animatePart(part, target.pos, target.quat, 0.55, 0, easeOutCubic);
    }
    updateSelectionUI();
    updateStatusMeta();
    if (state.autoFocus && state.exploded) flyToPose(getExplodedPose(), 1.1);
  }

  function toggleExplode() {
    setExploded(!state.exploded, {});
  }

  function updateExplodeButton() {
    if (!dom.btnExplode) return;
    dom.explodeLabel.textContent = state.exploded ? '一键组装' : '一键拆解';
    dom.btnExplode.classList.toggle('is-assembling', state.exploded);
    dom.btnExplode.setAttribute('aria-pressed', String(state.exploded));
  }

  /* ============================================================
     glow + halos
     ============================================================ */
  function updateGlow(dt) {
    if (!model) return;
    const pulse = 0.84 + 0.16 * Math.sin(elapsed * 4.4);
    model.parts.forEach(function (part) {
      const isSel = state.selected === part.id;
      const isHov = state.hovered === part.id;
      part.glowTarget = isSel ? 1 : (isHov ? 0.32 : 0);
      part.glow += (part.glowTarget - part.glow) * Math.min(1, dt * 8.5);
      if (part.glow < 0.006 && part.glowTarget === 0) {
        if (part._glowApplied) {
          part.glowMats.forEach(function (m) {
            m.emissive.copy(m.userData.baseEmissive || new THREE.Color(0x000000));
            m.emissiveIntensity = m.userData.baseEmissiveIntensity === undefined ? 1 : m.userData.baseEmissiveIntensity;
          });
          part._glowApplied = false;
        }
      } else if (part.glowMats.length) {
        part._glowApplied = true;
        const col = customColors[part.id];
        const plateScale = (part.id === 'mount' || part.id === 'frontCover' || part.id === 'rearCover') ? 0.55 : 1;
        // Keep the selection readable without self-illuminating the whole
        // part into a flat blob: the outline ring + label + detail panel
        // already carry the "selected" state.
        const strength = part.glow * (isSel ? 0.26 : 0.14) * (isSel ? pulse : 1) * plateScale;
        part.glowMats.forEach(function (m) {
          m.emissive.copy(col);
          m.emissiveIntensity = strength;
        });
      }
      // focus ring (a very soft halo sprite is intentionally left disabled so
      // it never washes out large parts such as the lens)
      const h = halos[part.id];
      if (h) {
        const visible = part.glow > 0.02;
        h.halo.visible = false;
        h.ring.visible = visible;
        if (visible) {
          part.pivot.getWorldPosition(tmpV);
          const ringSize = Math.min(Math.max(part.size.x, part.size.y) * 0.5, 2.5);
          h.ring.position.copy(tmpV);
          h.ring.scale.set(ringSize, ringSize, 1);
          h.ring.lookAt(camera.position);
          h.ring.rotation.z += dt * 0.5;
          h.ringMat.opacity = part.glow * 0.14;
        }
      }
    });
  }

  /* ============================================================
     UI: part list, details, specs
     ============================================================ */
  const MODEL_SPECS = [
    {
      title: '影像系统', key: 'IMAGING',
      rows: [
        ['传感器', '1/1.3 英寸 CMOS'], ['照片', '3648 × 2736 · 约 1000 万像素'],
        ['光圈', 'f/2.8'], ['视场角', '155°（对角）'],
        ['对焦范围', '0.4 m ~ ∞'],
        ['视频', '4K 16:9 ≤120fps · 4K 4:3 ≤60fps'],
        ['慢动作', '1080p ≤240fps / 4K ≤120fps'],
        ['编码 / 码流', 'MP4 · H.264 / HEVC · 130 Mbps'],
        ['色彩', '10-bit D-Log M']
      ]
    },
    {
      title: '防抖与增稳', key: 'STABILISATION',
      rows: [
        ['防抖算法', 'RockSteady 3.0 / 3.0+'], ['地平线校正', 'HorizonBalancing'],
        ['地平线增稳', 'HorizonSteady'], ['实现方式', '电子增稳（EIS）']
      ]
    },
    {
      title: '显示与操控', key: 'DISPLAY',
      rows: [
        ['前置屏', '1.4 英寸 · 320×320 · 323 ppi · 750 nit · 触控'],
        ['后置屏', '2.25 英寸 · 640×360 · 326 ppi · 750 nit · 触控'],
        ['触控策略', '前后屏不能同时触控'],
        ['按键', '拍摄按键（红环）/ QS 快速切换'], ['防水', '裸机 18 m · IP68（加壳 60 m）']
      ]
    },
    {
      title: '机身与电池', key: 'HARDWARE',
      rows: [
        ['尺寸', '70.5 × 44.2 × 32.8 mm'], ['重量', '145 g'],
        ['电池', '耐寒长续航电池 · LiPo 1S'],
        ['容量 / 能量', '1770 mAh / 6.8 Wh / 3.85 V'],
        ['续航', '约 160 分钟（1080p/24fps）'],
        ['充电', '30 W：18 min 充至 80% · 49 min 充满'],
        ['温度', '-20°C ~ 45°C 使用 / 5°C ~ 40°C 充电']
      ]
    },
    {
      title: '连接 · 存储 · 音频', key: 'CONNECTIVITY',
      rows: [
        ['无线', 'Wi-Fi 802.11 a/b/g/n/ac · BLE 5.0'], ['USB', 'USB-C 充电 / 数据传输'],
        ['存储', 'microSD ≤512 GB · exFAT / 无内置存储'],
        ['麦克风', '3 个（前 2 + 底部防风 1）'], ['音频', '48 kHz 16-bit AAC'],
        ['安装', 'DJI 磁吸快拆 + 双侧卡槽']
      ]
    }
  ];

  function buildPartList() {
    if (!dom.partList) return;
    dom.partList.innerHTML = '';
    dom.partCount.textContent = model.parts.length;
    model.parts.forEach(function (part) {
      const meta = part.meta;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'part-item';
      btn.dataset.id = meta.id;
      btn.setAttribute('role', 'listitem');
      btn.style.setProperty('--accent', meta.accent);
      const shortSpec = meta.labelSpec.split(' · ')[0];
      btn.innerHTML =
        '<span class="pi-index">' + part.index + '</span>' +
        '<span class="pi-copy">' +
        '<span class="pi-name">' + meta.name + '<em>' + shortSpec + '</em></span>' +
        '<span class="pi-en">' + meta.en + '</span>' +
        '</span>' +
        '<span class="pi-arrow">›</span>';
      btn.addEventListener('click', function () { selectPart(meta.id); });
      btn.addEventListener('mouseenter', function () { state.hovered = meta.id; });
      btn.addEventListener('mouseleave', function () {
        if (state.hovered === meta.id) state.hovered = null;
      });
      dom.partList.appendChild(btn);
    });
  }

  function setActiveListItem(id) {
    Array.prototype.forEach.call(dom.partList.children, function (child) {
      child.classList.toggle('is-active', child.dataset.id === id);
    });
  }

  function renderOverview() {
    if (!state.ready) {
      dom.infoBody.innerHTML = '<div class="overview"><div class="ov-eyebrow">SYSTEM BOOT</div><h2>Loading <span>...</span></h2></div>';
      return;
    }
    const partTotal = model ? model.parts.length : 14;
    dom.infoBody.innerHTML =
      '<div class="overview">' +
        '<div class="ov-eyebrow">DEVICE OVERVIEW / 整机概览</div>' +
        '<h2>Osmo <span>Action 4</span></h2>' +
        '<p>一台为极限运动而生的口袋相机。点击任意部件进入爆炸拆解视图，逐层了解它的光学、影像、散热与结构设计。</p>' +
        '<div class="ov-grid">' +
          '<div class="ov-stat"><b>1/1.3"</b><span>CMOS 传感器</span></div>' +
          '<div class="ov-stat"><b>155°</b><span>超广角视场</span></div>' +
          '<div class="ov-stat"><b>4K/120</b><span>视频规格</span></div>' +
          '<div class="ov-stat"><b>18 m</b><span>裸机防水</span></div>' +
          '<div class="ov-stat"><b>1770</b><span>mAh 电池</span></div>' +
          '<div class="ov-stat"><b>' + partTotal + '</b><span>可拆解部件</span></div>' +
        '</div>' +
        '<div class="ov-hint">' +
          '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h9M9 5l5 5-5 5"/></svg>' +
          '<span>点击画面中的任意部件，或从左侧部件清单选择，开始逐层拆解与参数查看。</span>' +
        '</div>' +
        '<ul class="ov-points">' +
          '<li>拆解时部件沿三维方向爆炸展开，选中部件会自动定位到最佳观察角度。</li>' +
          '<li>右侧面板提供关键参数、材质与拆解说明；「整机规格」页可查看完整规格。</li>' +
          '<li>镜头、前屏、电池仓等外部布局依据 DJI 官方手册；内部结构为示意级还原。</li>' +
          '<li>底部操作坞支持一键拆解 / 组装、自动旋转、标注开关与自动视角切换。</li>' +
        '</ul>' +
      '</div>';
  }

  function renderDetail(part) {
    const meta = part.meta;
    const specs = meta.specs.map(function (s) {
      return '<div class="spec-row"><span class="sk">' + s[0] + '</span><b class="sv">' + s[1] + '</b></div>';
    }).join('');
    const tags = meta.tags.map(function (t) { return '<span>' + t + '</span>'; }).join('');
    dom.infoBody.innerHTML =
      '<div class="detail" style="--accent:' + meta.accent + '">' +
        '<div class="detail-top">' +
          '<div class="detail-index">' + part.index + '</div>' +
          '<div class="detail-heading">' +
            '<div class="detail-kicker">' + meta.cat + '</div>' +
            '<h2>' + meta.name + '</h2>' +
            '<div class="detail-en">' + meta.en + '</div>' +
          '</div>' +
          '<button class="detail-clear" type="button" data-detail-close aria-label="取消选中">×</button>' +
        '</div>' +
        '<p class="detail-desc">' + meta.desc + '</p>' +
        '<div class="block-title">关键参数<span>SPECIFICATIONS</span></div>' +
        '<div class="spec-grid">' + specs + '</div>' +
        '<div class="block-title">材质 / 工艺<span>MATERIALS &amp; CRAFT</span></div>' +
        '<div class="chips">' + tags + '</div>' +
        '<div class="detail-note"><span>TEARDOWN NOTE</span><p>' + meta.note + '</p></div>' +
        '<div class="detail-footnote">部件 ' + part.index + ' / ' + String(model.parts.length).padStart(2, '0') + ' · ' +
          (state.exploded ? '已拆解' : '已组装') + ' · 点击空白处取消选中</div>' +
      '</div>';
    dom.infoBody.scrollTop = 0;
  }

  function renderSpecs() {
    const hero =
      '<div class="spec-hero"><b>1/1.3"</b><span>CMOS SENSOR · 155° ULTRA WIDE · 4K/120</span></div>';
    const sections = MODEL_SPECS.map(function (sec) {
      const rows = sec.rows.map(function (r) {
        return '<div class="spec-row"><span class="sk">' + r[0] + '</span><b class="sv">' + r[1] + '</b></div>';
      }).join('');
      return '<div class="spec-section"><h3><i></i>' + sec.title +
        '<span style="margin-left:auto;font-family:var(--mono);font-size:8px;color:var(--dim);letter-spacing:.14em">' + sec.key + '</span></h3>' +
        rows + '</div>';
    }).join('');
    dom.infoBody.innerHTML =
      '<div class="spec-tab">' + hero + sections +
      '<div class="detail-footnote">规格数据来源于 DJI 官方资料 · 部分内部结构为可视化示意</div></div>';
    dom.infoBody.scrollTop = 0;
  }

  function updateSelectionUI() {
    if (!state.ready && !model) return;
    const id = state.selected;
    setActiveListItem(id);
    const has = !!id;
    dom.btnFocusSelected.disabled = !has;
    if (id && model.byId[id]) {
      const meta = model.byId[id].meta;
      dom.panelInfo.style.setProperty('--accent', meta.accent);
      if (state.tab !== 'detail') setTab('detail', true);
      renderDetail(model.byId[id]);
    } else {
      dom.panelInfo.style.removeProperty('--accent');
      if (state.tab === 'detail') renderOverview();
    }
    if (dom.labelsLayer) dom.labelsLayer.classList.toggle('has-selection', !!id);
    Object.keys(labelEls).forEach(function (k) {
      labelEls[k].el.classList.toggle('is-selected', k === id);
    });
  }

  function setTab(tab, silent) {
    state.tab = tab;
    dom.tabs.forEach(function (btn) {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    if (dom.tabUnderline) {
      dom.tabUnderline.style.transform = tab === 'specs' ? 'translateX(100%)' : 'translateX(0)';
    }
    if (!silent && state.ready) {
      if (tab === 'specs') renderSpecs();
      else if (state.selected && model.byId[state.selected]) renderDetail(model.byId[state.selected]);
      else renderOverview();
    }
  }

  function updateStatusMeta() {
    if (!dom.statusMeta) return;
    if (state.selected && model && model.byId[state.selected]) {
      const part = model.byId[state.selected];
      dom.statusMeta.textContent = 'PART ' + part.index + ' / ' + String(model.parts.length).padStart(2, '0') + ' · ' + part.meta.en;
    } else {
      dom.statusMeta.textContent = '14 PARTS · 1/1.3" CMOS';
    }
  }

  /* ============================================================
     labels
     ============================================================ */
  function buildLabels() {
    if (!dom.labelNodes || !dom.leaderSvg) return;
    const NS = 'http://www.w3.org/2000/svg';
    model.parts.forEach(function (part) {
      const meta = part.meta;
      const el = document.createElement('div');
      el.className = 'part-label';
      el.dataset.id = meta.id;
      el.style.setProperty('--accent', meta.accent);
      el.innerHTML =
        '<i class="pl-dot"></i>' +
        '<div class="pl-body">' +
          '<span class="pl-name"><span class="pl-label">' + part.index + '</span>' + meta.name + '</span>' +
          '<span class="pl-spec">' + meta.labelSpec + '</span>' +
        '</div>';
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selectPart(meta.id);
      });
      dom.labelNodes.appendChild(el);

      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'leader-g');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('stroke', meta.accent);
      path.setAttribute('stroke-opacity', '0.5');
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('r', '2.2');
      circle.setAttribute('fill', meta.accent);
      circle.setAttribute('fill-opacity', '0.9');
      g.appendChild(path);
      g.appendChild(circle);
      dom.leaderSvg.appendChild(g);

      labelEls[meta.id] = { el: el, g: g, path: path, circle: circle, w: 0, h: 0 };
    });
  }

  function hideAllLabels() {
    Object.keys(labelEls).forEach(function (k) {
      labelEls[k].el.classList.remove('is-visible');
      labelEls[k].g.classList.remove('is-visible');
    });
  }

  function getSafeArea() {
    const w = window.innerWidth, h = window.innerHeight;
    if (window.innerWidth <= MOBILE_BREAKPOINT) {
      return { left: 12, right: w - 12, top: 74, bottom: h - 92 };
    }
    const leftPanel = dom.panelParts ? dom.panelParts.getBoundingClientRect() : null;
    const rightPanel = dom.panelInfo ? dom.panelInfo.getBoundingClientRect() : null;
    let left = leftPanel ? leftPanel.right + 16 : 30;
    let right = rightPanel ? rightPanel.left - 16 : w - 30;
    if (right - left < 340) {
      left = Math.min(left, w * 0.18);
      right = Math.max(right, w * 0.82);
    }
    return { left: left, right: right, top: 96, bottom: h - 108 };
  }

  function updateLabels() {
    if (!model || !state.ready) return;
    if (!dom.labelNodes) return;
    const w = window.innerWidth, h = window.innerHeight;
    const live = state.exploded && state.labelsOn && w > 680;
    const safe = getSafeArea();
    const entries = [];
    camera.getWorldDirection(camForward);

    model.parts.forEach(function (part) {
      const L = labelEls[part.id];
      if (!L) return;
      if (!live) {
        L.el.classList.remove('is-visible');
        L.g.classList.remove('is-visible');
        return;
      }
      part.anchor.getWorldPosition(tmpV);
      tmpV2.copy(tmpV).sub(camera.position);
      if (tmpV2.dot(camForward) <= 0.3) {
        L.el.classList.remove('is-visible');
        L.g.classList.remove('is-visible');
        return;
      }
      tmpV.project(camera);
      if (tmpV.z < -1 || tmpV.z > 1) {
        L.el.classList.remove('is-visible');
        L.g.classList.remove('is-visible');
        return;
      }
      const ax = (tmpV.x * 0.5 + 0.5) * w;
      const ay = (-tmpV.y * 0.5 + 0.5) * h;
      if (ax < -120 || ax > w + 120 || ay < -120 || ay > h + 120) {
        L.el.classList.remove('is-visible');
        L.g.classList.remove('is-visible');
        return;
      }
      if (!L.w) {
        L.w = L.el.offsetWidth || 120;
        L.h = L.el.offsetHeight || 34;
      }
      entries.push({ part: part, L: L, ax: ax, ay: ay });
    });

    entries.forEach(function (e) {
      const dir = e.part.meta.labelDir;
      e.cx = clamp(e.ax + dir[0], safe.left + e.L.w / 2, safe.right - e.L.w / 2);
      e.cy = clamp(e.ay + dir[1], safe.top + e.L.h / 2, safe.bottom - e.L.h / 2);
    });

    // simple collision resolution (top to bottom)
    const sorted = entries.slice().sort(function (a, b) { return a.cy - b.cy; });
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = 0; j < i; j++) {
        const b = sorted[j];
        const overlapX = Math.abs(a.cx - b.cx) < (a.L.w + b.L.w) / 2 + 10;
        const overlapY = Math.abs(a.cy - b.cy) < (a.L.h + b.L.h) / 2 + 7;
        if (overlapX && overlapY) {
          a.cy = b.cy + (a.L.h + b.L.h) / 2 + 7;
          a.cy = Math.min(a.cy, safe.bottom - a.L.h / 2);
          a.cx = clamp(a.cx, safe.left + a.L.w / 2, safe.right - a.L.w / 2);
        }
      }
    }

    entries.forEach(function (e) {
      e.L.el.style.transform = 'translate3d(' + e.cx.toFixed(1) + 'px,' + e.cy.toFixed(1) + 'px,0) translate(-50%,-50%)';
      e.L.el.classList.add('is-visible');
      e.L.el.classList.toggle('is-selected', state.selected === e.part.id);

      const edgeX = e.cx >= e.ax ? e.cx - e.L.w / 2 : e.cx + e.L.w / 2;
      const elbowX = e.ax + (edgeX - e.ax) * 0.45;
      e.L.path.setAttribute('d',
        'M ' + e.ax.toFixed(1) + ' ' + e.ay.toFixed(1) +
        ' L ' + elbowX.toFixed(1) + ' ' + e.ay.toFixed(1) +
        ' L ' + edgeX.toFixed(1) + ' ' + e.cy.toFixed(1));
      e.L.circle.setAttribute('cx', e.ax.toFixed(1));
      e.L.circle.setAttribute('cy', e.ay.toFixed(1));
      e.L.g.classList.add('is-visible');
      e.L.g.classList.toggle('is-selected-g', state.selected === e.part.id);
    });
  }

  /* ============================================================
     interaction: picking, hover, keyboard
     ============================================================ */
  function raycastPart(clientX, clientY) {
    if (!model) return null;
    const rect = dom.scene.getBoundingClientRect();
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(model.pickables, false);
    if (hits.length) return hits[0].object.userData.partId || null;
    return null;
  }

  function hideHover() {
    if (state.hovered) state.hovered = null;
    if (dom.hoverTag) dom.hoverTag.classList.remove('is-visible');
    if (dom.scene) dom.scene.style.cursor = 'grab';
  }

  function showHover(id, x, y) {
    if (!id || !model || !model.byId[id]) { hideHover(); return; }
    state.hovered = id;
    const part = model.byId[id];
    dom.hoverIndex.textContent = part.index;
    dom.hoverName.textContent = part.meta.name;
    const w = window.innerWidth;
    const tagW = 230;
    let tx = x + 18, ty = y + 16;
    if (tx + tagW > w - 10) tx = x - tagW - 10;
    if (ty + 40 > window.innerHeight - 10) ty = y - 46;
    dom.hoverTag.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0)';
    dom.hoverTag.classList.add('is-visible');
    if (dom.scene) dom.scene.style.cursor = 'pointer';
  }

  function updateHover(clientX, clientY) {
    if (!state.ready || state.dragging) return;
    const id = raycastPart(clientX, clientY);
    if (id) showHover(id, clientX, clientY);
    else hideHover();
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) {
      hideHover();
      return;
    }
    pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  function onPointerUp(e) {
    const down = pointerDown;
    pointerDown = null;
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (dx * dx + dy * dy > 36) return;
    if (performance.now() - down.t > 900) return;
    const id = raycastPart(e.clientX, e.clientY);
    if (id) {
      selectPart(id);
    } else {
      deselect();
      if (state.mobile) closeMobilePanels();
    }
    hideHover();
  }

  function onPointerMove(e) {
    pendingPointer = { x: e.clientX, y: e.clientY };
    if (state.dragging) { hideHover(); return; }
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(function () {
      hoverRaf = 0;
      if (pendingPointer) updateHover(pendingPointer.x, pendingPointer.y);
    });
  }

  function openGuide() {
    if (!dom.guideModal) return;
    dom.guideModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeGuide() {
    if (!dom.guideModal) return;
    dom.guideModal.hidden = true;
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        const r = req.call(el);
        if (r && r.catch) r.catch(function () {});
      }
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  }
  function openMobilePanel(which) {
    if (!state.mobile) return;
    hideToast();
    if (which === 'parts') {
      dom.panelParts.classList.add('is-open');
      dom.panelInfo.classList.remove('is-open');
    } else {
      dom.panelInfo.classList.add('is-open');
      dom.panelParts.classList.remove('is-open');
    }
  }
  function closeMobilePanels() {
    dom.panelParts.classList.remove('is-open');
    dom.panelInfo.classList.remove('is-open');
  }
  function anyMobilePanelOpen() {
    return state.mobile && (
      dom.panelParts.classList.contains('is-open') ||
      dom.panelInfo.classList.contains('is-open')
    );
  }

  function initUI() {
    buildPartList();
    buildLabels();
    updateSelectionUI();
    updateExplodeButton();
    updateStatusMeta();

    dom.tabs.forEach(function (btn) {
      btn.addEventListener('click', function () { setTab(btn.dataset.tab); });
    });

    dom.btnExplode.addEventListener('click', toggleExplode);
    dom.btnReset.addEventListener('click', function () {
      flyToPose(state.exploded ? getExplodedPose() : getDefaultPose(), 1.2);
      if (state.autoRotate) {
        state.autoRotate = false;
        controls.autoRotate = false;
        dom.btnAutoRotate.classList.remove('is-on');
        dom.btnAutoRotate.setAttribute('aria-pressed', 'false');
      }
      showToast('视角已复位', 1800);
    });
    dom.btnAutoRotate.addEventListener('click', function () {
      state.autoRotate = !state.autoRotate;
      controls.autoRotate = state.autoRotate;
      dom.btnAutoRotate.classList.toggle('is-on', state.autoRotate);
      dom.btnAutoRotate.setAttribute('aria-pressed', String(state.autoRotate));
      showToast(state.autoRotate ? '自动旋转已开启' : '自动旋转已关闭', 1600);
    });
    dom.btnLabels.addEventListener('click', function () {
      state.labelsOn = !state.labelsOn;
      dom.btnLabels.classList.toggle('is-on', state.labelsOn);
      dom.btnLabels.setAttribute('aria-pressed', String(state.labelsOn));
      if (!state.labelsOn) hideAllLabels();
      showToast(state.labelsOn ? '部件标注已开启' : '部件标注已关闭', 1600);
    });
    dom.btnFocusCam.addEventListener('click', function () {
      state.autoFocus = !state.autoFocus;
      dom.btnFocusCam.classList.toggle('is-on', state.autoFocus);
      dom.btnFocusCam.setAttribute('aria-pressed', String(state.autoFocus));
      showToast(state.autoFocus ? '自动视角已开启' : '自动视角已关闭', 1600);
    });

    dom.btnGuide.addEventListener('click', openGuide);
    dom.closeGuide.forEach(function (el) { el.addEventListener('click', closeGuide); });
    dom.btnFullscreen.addEventListener('click', toggleFullscreen);
    dom.btnMobileParts.addEventListener('click', function () {
      if (dom.panelParts.classList.contains('is-open')) closeMobilePanels();
      else openMobilePanel('parts');
    });
    dom.btnMobileInfo.addEventListener('click', function () {
      if (dom.panelInfo.classList.contains('is-open')) closeMobilePanels();
      else openMobilePanel('info');
    });
    dom.btnCloseInfo.addEventListener('click', function () {
      if (state.mobile) { closeMobilePanels(); return; }
      deselect();
    });
    dom.btnFocusSelected.addEventListener('click', function () {
      if (state.selected && model.byId[state.selected]) focusPart(model.byId[state.selected]);
      else showToast('请先选中一个部件', 1800);
    });

    dom.infoBody.addEventListener('click', function (e) {
      if (e.target.closest('[data-detail-close]')) deselect();
    });

    dom.scene.addEventListener('pointerdown', onPointerDown);
    dom.scene.addEventListener('pointerup', onPointerUp);
    dom.scene.addEventListener('pointermove', onPointerMove);
    dom.scene.addEventListener('pointerleave', function () { pointerDown = null; hideHover(); });
    dom.scene.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('keydown', function (e) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' || e.code === 'Space') {
        if (tag === 'BUTTON') return;
        e.preventDefault();
        if (!dom.guideModal.hidden) return;
        toggleExplode();
      } else if (e.key === 'r' || e.key === 'R') {
        flyToPose(state.exploded ? getExplodedPose() : getDefaultPose(), 1.2);
      } else if (e.key === 'l' || e.key === 'L') {
        dom.btnLabels.click();
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.key === 'Escape') {
        if (!dom.guideModal.hidden) closeGuide();
        else if (state.selected) deselect();
        else if (state.mobile) closeMobilePanels();
      } else if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        if (!dom.guideModal.hidden) closeGuide(); else openGuide();
      }
    });

    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', function () {
      // no-op; button works as a toggle
    });
  }

  /* ============================================================
     resizing / adaptive quality
     ============================================================ */
  function onResize() {
    if (!renderer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    state.mobile = w <= MOBILE_BREAKPOINT;
    camera.aspect = w / h;
    camera.fov = state.mobile ? 50 : 38;
    camera.updateProjectionMatrix();
    if (controls) controls.maxDistance = state.mobile ? 64 : 34;
    renderer.setSize(w, h);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    }
    labelCacheW = 0;
    Object.keys(labelEls).forEach(function (k) { labelEls[k].w = 0; labelEls[k].h = 0; });
    if (dom.leaderSvg) {
      dom.leaderSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      dom.leaderSvg.setAttribute('width', w);
      dom.leaderSvg.setAttribute('height', h);
    }
    if (!state.mobile) closeMobilePanels();
  }

  function updateAdaptiveQuality(dt) {
    if (!state.ready || !renderer || !(dt > 0)) return;
    // smoothed frame time in ms, clamped so a single hitch alone cannot
    // trigger a quality change
    const ms = Math.min(64, dt * 1000);
    state.frameTimeAvg = state.frameTimeAvg === 0
      ? ms
      : state.frameTimeAvg + (ms - state.frameTimeAvg) * 0.06;
    if (state.qualityCooldown > 0) {
      state.qualityCooldown = Math.max(0, state.qualityCooldown - dt);
      return;
    }
    // One-way safety net: if the device cannot hold ~40 fps at the current
    // tier we step down once and never step back up automatically, so the
    // resolution can never visibly flap during a session.
    if (state.qualityDowngraded) return;
    if (state.frameTimeAvg > 25 && state.qualityTier > 0) {
      state.downFrames = (state.downFrames || 0) + 1;
      if (state.downFrames > 90) {
        state.downFrames = 0;
        applyQuality(state.qualityTier - 1);
        state.qualityCooldown = 2.4;
        showToast('已自动降低画质以保持流畅', 2400);
      }
    } else {
      state.downFrames = 0;
    }
  }

  /* ============================================================
     toast / meter
     ============================================================ */
  function hideToast() {
    if (!dom.toast) return;
    clearTimeout(toastTimer);
    dom.toast.classList.remove('is-visible');
  }

  function showToast(text, duration) {
    if (!dom.toast) return;
    // On phones the drawers cover nearly the whole viewport; a toast on top of
    // an open drawer would only add visual noise. Panel content is the feedback.
    if (anyMobilePanelOpen()) return;
    clearTimeout(toastTimer);
    dom.toast.textContent = text;
    dom.toast.classList.add('is-visible');
    toastTimer = setTimeout(function () {
      dom.toast.classList.remove('is-visible');
    }, duration || 2600);
  }

  function updateMeter(now) {
    const target = state.exploded ? 1 : 0;
    const t = clamp((now - state.explodeStart) / 1150, 0, 1);
    const e = easeOutCubic(t);
    state.explodeVisual = state.explodeFrom + (target - state.explodeFrom) * e;
    const pct = Math.round(state.explodeVisual * 100);
    if (pct !== lastMeterPct) {
      lastMeterPct = pct;
      if (dom.explodePct) dom.explodePct.textContent = String(pct).padStart(2, '0') + '%';
      if (dom.explodeMeter) dom.explodeMeter.style.width = pct + '%';
    }
  }

  /* ============================================================
     main loop
     ============================================================ */
  function animate(now) {
    animFrame = requestAnimationFrame(animate);
    if (!renderer || !scene || !camera) return;
    // manual reset: counters must cover every composer pass, not just the last
    renderer.info.reset();
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0.016);
    lastTime = now;
    elapsed += dt;

    updateCameraTween(now);

    if (state.intro) {
      // gentle drift during boot
      if (!bootHidden) {
        camera.position.x += Math.sin(now * 0.0002) * 0.001;
        camera.lookAt(0, 0.6, 0);
      }
    }

    controls.update();
    updatePartAnims(now);
    updateGlow(dt);
    updateLabels();
    updateMeter(now);

    // baked contact shadow: strongest when assembled, fades while the parts
    // scatter (a solid black blob under an exploded body looks wrong)
    if (stage.shadow && stage.shadow.material) {
      stage.shadow.material.opacity = 0.5 * (1 - state.explodeVisual * 0.92);
      const blobScale = 1 + state.explodeVisual * 0.28;
      stage.shadow.scale.set(blobScale, blobScale, 1);
    }

    // model float
    if (model) {
      model.root.position.y = model.deviceY + Math.sin(elapsed * 0.85) * 0.045;
      if (!state.exploded) {
        model.root.rotation.y = Math.sin(elapsed * 0.28) * 0.012;
      }
    }

    // stage motion
    if (stage.hud) {
      stage.hud.rotation.y += dt * 0.035;
      stage.hud.position.y = 0.75 + Math.sin(elapsed * 0.5) * 0.03;
    }
    if (stage.floorRings) {
      stage.floorRings.rotation.y += dt * 0.012;
    }
    if (stage.dust) {
      stage.dust.rotation.y += dt * 0.004;
      stage.dust.rotation.x = Math.sin(elapsed * 0.05) * 0.02;
    }
    if (stage.dustBig) stage.dustBig.rotation.y -= dt * 0.003;
    if (stage.gridMat) stage.gridMat.uniforms.uTime.value = elapsed;
    if (stage.backA) stage.backA.material.opacity = 0.2 + Math.sin(elapsed * 0.5) * 0.03;
    if (stage.backB) stage.backB.material.opacity = 0.1 + Math.sin(elapsed * 0.4 + 1.7) * 0.02;

    updateAdaptiveQuality(dt);

    composer.render();
    if (state.ready && !bootHidden) hideBoot();
    if (state.ready) updateHoverCursor();
  }

  function updateHoverCursor() {
    if (!dom.scene) return;
    if (state.dragging) return;
    if (!dom.hoverTag.classList.contains('is-visible') && dom.scene.style.cursor !== 'grab') {
      dom.scene.style.cursor = 'grab';
    }
  }

  /* ============================================================
     init
     ============================================================ */
  /* ============================================================
     post-processing building blocks
     ============================================================ */

  // Every frame is drawn into the composer's offscreen target, so the canvas
  // `antialias` flag never reaches the scene: MSAA has to live here. This is
  // the single biggest image-quality lever of the whole page.
  function makeComposerTarget(samples) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));
    const target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: samples || 0,
      stencilBuffer: false,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false
    });
    target.texture.name = 'composer.msaa';
    return target;
  }

  function rebuildComposerTarget() {
    if (!composer) return;
    composer.reset(makeComposerTarget(currentTier().samples));
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  // Minimal full-screen triangle. three's official addons ship FullScreenQuad,
  // but the vendored bundle only contains a handful of modules.
  function makeFullScreenTriangle(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -1, -1, 0, 3, -1, 0, -1, 3, 0
    ], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    return {
      mesh: mesh,
      render: function (r) { r.render(mesh, cam); },
      dispose: function () { geo.dispose(); }
    };
  }

  // Final display-space pass: sub-LSB interleaved-gradient noise. The scene is
  // rendered in HDR and tone-mapped to 8 bit, which visibly banded the dark
  // radial gradients and the floor glow.
  function DitherPass() {
    this.enabled = true;
    this.needsSwap = false;
    this.clear = false;
    this.renderToScreen = false;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uAmount: { value: 1.15 }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){',
        '  vUv = uv;',
        '  gl_Position = vec4(position.xy, 0.0, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'precision highp float;',
        'uniform sampler2D tDiffuse;',
        'uniform vec2 uResolution;',
        'uniform float uAmount;',
        'varying vec2 vUv;',
        'float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }',
        'void main(){',
        '  vec3 c = texture2D(tDiffuse, vUv).rgb;',
        '  float n = ign(floor(vUv * uResolution)) - 0.5;',
        '  c += n * (uAmount / 255.0);',
        '  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);',
        '}'
      ].join('\n'),
      depthTest: false,
      depthWrite: false
    });
    this.quad = makeFullScreenTriangle(this.material);
  }
  DitherPass.prototype.setSize = function (w, h) {
    this.material.uniforms.uResolution.value.set(Math.max(1, w), Math.max(1, h));
  };
  DitherPass.prototype.render = function (renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this.quad.render(renderer);
  };

  function initComposer() {
    composer = new EffectComposer(renderer, makeComposerTarget(currentTier().samples));
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(window.innerWidth, window.innerHeight);

    composer.addPass(new RenderPass(scene, camera));

    // Bloom used to be strong and wide, which fogged the screen content and
    // the silk-print. Keep it as a tight specular accent instead.
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.26, 0.42, 0.92
    );
    // The glow is low frequency: running its mip chain at a fraction of the
    // frame size is visually identical and ~4x cheaper.
    const bloomSetSize = bloomPass.setSize.bind(bloomPass);
    bloomPass.setSize = function (w, h) {
      const s = currentTier().bloomScale || 0.5;
      bloomSetSize(Math.max(8, Math.round(w * s)), Math.max(8, Math.round(h * s)));
    };
    bloomPass.enabled = currentTier().bloomEnabled;
    composer.addPass(bloomPass);

    composer.addPass(new OutputPass());

    ditherPass = new DitherPass();
    composer.addPass(ditherPass);

    // route the initial sizing through the overridden setSize chain
    composer.setSize(window.innerWidth, window.innerHeight);
  }

  function init() {
    cacheDom();
    boot(10, '初始化渲染管线…');
    initRenderer();
    initScene();
    boot(24, '生成环境光照与后处理…');
    initEnvironment();
    initLights();
    boot(38, '构建程序化材质…');
    initModel();
    initStage();
    boot(64, '装配 14 个可拆解部件…');
    initControls();
    initComposer();
    boot(82, '连接交互与标注系统…');
    initUI();
    onResize();
    setTab('detail', true);
    renderOverview();
    boot(94);
    updateStatusMeta();
    state.ready = true;
    state.qualityCooldown = 2.0;
    renderOverview();
    // first frame
    composer.render();
    boot(100, '系统就绪');
    hideBoot();
    animate(performance.now());

    // expose a small debug / automation API
    window.DJI_APP = {
      state: state,
      selectPart: selectPart,
      deselect: deselect,
      setExploded: setExploded,
      toggleExplode: toggleExplode,
      focusPart: focusPart,
      flyToPose: flyToPose,
      getModel: function () { return model; },
      getCamera: function () { return camera; },
      getControls: function () { return controls; },
      getRenderer: function () { return renderer; },
      getComposer: function () { return composer; },
      getScene: function () { return scene; },
      getStage: function () { return stage; },
      getQuality: function () { return currentTier().name; },
      setQuality: function (name) {
        const index = QUALITY_INDEX[name];
        if (index === undefined) return false;
        state.qualityCooldown = 5;
        applyQuality(index);
        return true;
      },
      getStats: function () {
        const tier = currentTier();
        return {
          tier: tier.name,
          samples: tier.samples,
          dpr: renderer.getPixelRatio(),
          shadows: tier.shadowOn,
          shadowMap: tier.shadowOn ? tier.shadowMap : 0,
          bloom: tier.bloomEnabled,
          frameTimeAvg: state.frameTimeAvg,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          programs: renderer.info.programs ? renderer.info.programs.length : 0,
          textures: renderer.info.memory.textures,
          geometries: renderer.info.memory.geometries
        };
      },
      renderOnce: function () { if (composer) composer.render(); }
    };
  }

  function start() {
    cacheDom();
    window.setTimeout(function () {
      try {
        init();
      } catch (err) {
        console.error(err);
        showFallback(err && err.message ? err.message : '未知错误');
      }
    }, 80);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
