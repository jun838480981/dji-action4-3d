# Three.js vendor bundle

`three-bundle.min.js` is a locally bundled copy of:

- `three@0.169.0`
- addons: `OrbitControls`, `EffectComposer`, `RenderPass`, `UnrealBloomPass`,
  `OutputPass`, `RoundedBoxGeometry`

It exposes a single global `THREE_BUNDLE` containing `THREE` plus those addons,
so the page can be opened directly from `file://` without an import map,
a local server or a CDN.

Build command (from a temporary npm project):

```bash
npm i three@0.169.0 esbuild@0.24.0
# entry.js:
#   import * as THREE from 'three';
#   import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
#   import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
#   import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
#   import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
#   import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
#   import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
#   export { THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoundedBoxGeometry };
npx esbuild entry.js --bundle --minify --format=iife \
  --global-name=THREE_BUNDLE --legal-comments=eof \
  --outfile=../js/vendor/three-bundle.min.js
```

The Three.js MIT license text is preserved in the bundle footer and in
[`../../THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md).
