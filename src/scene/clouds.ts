import * as THREE from 'three';
import { mulberry32 } from './utils';

/* =====================================================================
   云层：实例化软广告牌（每帧按距离排序保证混合正确）
   - 三个高度带的积云团，坠落路径上刻意放置了可穿越的云
   - 逐实例朝阳面亮度 + 顶部/底部明暗 → 体积感
   - 逆光时边缘“银边”后向散射
   - 复用全局大气雾着色器块，色彩与地形一致
   - densityAt(camera) 用于穿云时的整体泛白
   ===================================================================== */

interface Puff {
  x: number; y: number; z: number;
  scale: number; rot: number; tex: number; alpha: number;
  r: number; g: number; b: number;
}
interface Cloud { x: number; y: number; z: number; rx: number; ry: number; rz: number; }

/* ---------- 4 种分形边缘的 puff 贴图（2x2 图集） ---------- */
function makePuffAtlas(): THREE.CanvasTexture {
  const S = 512, C = S / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const data = img.data;
  const rand = mulberry32(9137);
  const P = 64;
  const lat = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) lat[i] = rand();
  const vnoise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const tx = x - ix, ty = y - iy;
    const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
    const g = (i: number, j: number) => lat[((j % P) + P) % P * P + ((i % P) + P) % P];
    const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };
  const fbm = (x: number, y: number, oct: number) => {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f); n += a; a *= 0.5; f *= 2.07; }
    return s / n;
  };
  const sm = (e0: number, e1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = Math.floor(cell / 2) * C;
    const sx = cell * 13.7 + 3.1, sy = cell * 7.9 + 11.3;
    const blobs: [number, number, number][] = [];
    const nb = 4 + Math.floor(rand() * 4);
    for (let b = 0; b < nb; b++) blobs.push([(rand() - 0.5) * 0.7, (rand() - 0.5) * 0.5, 0.22 + rand() * 0.26]);
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const u = (x / C) * 2 - 1, v = (y / C) * 2 - 1;
        // 低频域扭曲，让轮廓不规则
        const wx = (fbm(u * 1.6 + sx, v * 1.6 + sy, 3) - 0.5) * 0.5;
        const wy = (fbm(u * 1.6 + sx + 31.0, v * 1.6 + sy + 17.0, 3) - 0.5) * 0.5;
        const uu = u + wx, vv = v + wy;
        let field = 0;
        for (const [bx, by, br] of blobs) {
          const d = Math.hypot(uu - bx, vv - by) / br;
          field += Math.max(0, 1 - d * d);
        }
        field = Math.min(field, 1.6);
        // 高频侵蚀
        const n = fbm(u * 5.5 + sx, v * 5.5 + sy, 5);
        const n2 = fbm(u * 12.0 + sy, v * 12.0 + sx, 3);
        let a = field * (0.45 + 1.1 * n) - 0.42 + 0.22 * (n2 - 0.5);
        a = sm(0.05, 0.95, a);
        a = Math.pow(a, 1.35);
        const rad = Math.hypot(u, v);
        a *= 1 - sm(0.78, 1.0, rad);
        const i = ((oy + y) * S + (ox + x)) * 4;
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
        data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

const cloudVertex = /* glsl */ `
  attribute vec3 iPos;
  attribute float iScale;
  attribute float iRot;
  attribute vec3 iCol;
  attribute float iTex;
  attribute float iAlpha;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vFade;
  varying vec3 vViewDir;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iRot), s = sin(iRot);
    vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iScale;
    mvPosition.xy += q;
    gl_Position = projectionMatrix * mvPosition;
    float ix = mod(iTex, 2.0), iy = floor(iTex / 2.0);
    vUv = (uv + vec2(ix, iy)) * 0.5;
    vCol = iCol;
    float d = length(mvPosition.xyz);
    // 相机贴近 / 穿过时淡出，避免硬裁切
    vFade = smoothstep(iScale * 0.3, iScale * 1.15, d) * iAlpha;
    vViewDir = normalize(mvPosition.xyz);
    #include <fog_vertex>
  }
`;

const cloudFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform vec3 uSunDirView;
  uniform vec3 uSilver;
  varying vec2 vUv;
  varying vec3 vCol;
  varying float vFade;
  varying vec3 vViewDir;
  #include <fog_pars_fragment>
  void main() {
    float a = texture2D(uMap, vUv).a;
    a *= vFade * uOpacity;
    if (a < 0.004) discard;
    vec3 col = vCol;
    // 逆光银边：薄处透光更强
    float back = pow(max(dot(vViewDir, uSunDirView), 0.0), 12.0);
    col += uSilver * back * (1.0 - a) * 1.4;
    gl_FragColor = vec4(col, a);
    #include <fog_fragment>
  }
`;

export interface CloudSystem {
  mesh: THREE.Mesh;
  update(camera: THREE.Camera, sunDir: THREE.Vector3): void;
  densityAt(p: THREE.Vector3): number;
  setVisible(v: boolean): void;
  dispose(): void;
}

export function createClouds(sunDir: THREE.Vector3): CloudSystem {
  const rand = mulberry32(20240613);
  const clouds: Cloud[] = [];
  const puffs: Puff[] = [];

  // 亮部略低于 1.0（避免整团被 Bloom 吃成光球），暗部偏蓝灰
  const sunCol = new THREE.Color(0.98, 0.955, 0.90);
  const shadeCol = new THREE.Color(0.40, 0.47, 0.62);
  const tmpC = new THREE.Color();

  const addCloud = (x: number, y: number, z: number, rx: number, ry: number, count: number) => {
    const rz = rx * (0.65 + rand() * 0.6);
    clouds.push({ x, y, z, rx, ry, rz });
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.pow(rand(), 0.55);
      const ox = Math.cos(a) * rr * rx, oz = Math.sin(a) * rr * rz;
      // 底部平、顶部隆起
      const oy = Math.pow(rand(), 0.7) * ry * (1 - 0.6 * rr * rr) - ry * 0.2;
      const px = x + ox, py = y + oy, pz = z + oz;
      const scale = (0.22 + rand() * 0.36) * Math.min(rx, 380) * (1 - 0.3 * rr);
      const nx = ox / rx, ny = oy / ry, nz = oz / rz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const facing = (nx / nl) * sunDir.x + (ny / nl) * sunDir.y + (nz / nl) * sunDir.z;
      const vert = Math.max(0, Math.min(1, (oy / ry + 0.2) / 1.0));
      let light = 0.42 + 0.58 * Math.max(0, Math.min(1, facing * 0.6 + 0.5));
      light *= 0.62 + 0.38 * vert;
      light = Math.max(0, Math.min(1, light + (rand() - 0.5) * 0.08));
      tmpC.copy(shadeCol).lerp(sunCol, light);
      puffs.push({
        x: px, y: py, z: pz, scale,
        rot: rand() * Math.PI * 2, tex: Math.floor(rand() * 4),
        alpha: 0.55 + rand() * 0.45,
        r: tmpC.r, g: tmpC.g, b: tmpC.b,
      });
    }
  };

  // 坠落路径上的可穿越云（中心附近）
  addCloud(60, 2060, -80, 480, 170, 34);
  addCloud(-140, 1240, 110, 420, 150, 30);
  // 高层积云带 1800-2300（稀疏，留出俯瞰地面的空隙）
  for (let i = 0; i < 11; i++) {
    const a = rand() * Math.PI * 2, d = 900 + rand() * 4600;
    addCloud(Math.cos(a) * d, 1850 + rand() * 420, Math.sin(a) * d, 260 + rand() * 380, 110 + rand() * 110, 16 + Math.floor(rand() * 10));
  }
  // 中层 1000-1450
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, d = 700 + rand() * 4000;
    addCloud(Math.cos(a) * d, 1000 + rand() * 420, Math.sin(a) * d, 220 + rand() * 320, 100 + rand() * 80, 14 + Math.floor(rand() * 8));
  }
  // 低层散云 520-760（着陆高度附近视野）
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2, d = 1000 + rand() * 3400;
    addCloud(Math.cos(a) * d, 520 + rand() * 240, Math.sin(a) * d, 160 + rand() * 200, 60 + rand() * 50, 10 + Math.floor(rand() * 6));
  }
  // 远处山脉上方的大型云团（背景）
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2, d = 6500 + rand() * 6500;
    addCloud(Math.cos(a) * d, 1700 + rand() * 500, Math.sin(a) * d, 600 + rand() * 700, 200 + rand() * 160, 18 + Math.floor(rand() * 10));
  }

  const count = puffs.length;
  const base = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const aPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const aScale = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  const aRot = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const aTex = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  const attrs = [aPos, aScale, aRot, aCol, aTex, aAlpha];
  for (const a of attrs) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos);
  geo.setAttribute('iScale', aScale);
  geo.setAttribute('iRot', aRot);
  geo.setAttribute('iCol', aCol);
  geo.setAttribute('iTex', aTex);
  geo.setAttribute('iAlpha', aAlpha);
  geo.instanceCount = count;

  const atlas = makePuffAtlas();
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: null },
        uOpacity: { value: 0.9 },
        uSunDirView: { value: new THREE.Vector3(0, 1, 0) },
        uSilver: { value: new THREE.Color(1.0, 0.9, 0.74) },
      },
    ]),
    vertexShader: cloudVertex,
    fragmentShader: cloudFragment,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.uniforms.uMap.value = atlas;

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;

  const order = new Array<number>(count);
  const dist = new Float32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  const camPos = new THREE.Vector3();
  const sunView = new THREE.Vector3();

  const writeSorted = () => {
    for (let k = 0; k < count; k++) {
      const p = puffs[order[k]];
      aPos.setXYZ(k, p.x, p.y, p.z);
      aScale.setX(k, p.scale);
      aRot.setX(k, p.rot);
      aCol.setXYZ(k, p.r, p.g, p.b);
      aTex.setX(k, p.tex);
      aAlpha.setX(k, p.alpha);
    }
    for (const a of attrs) a.needsUpdate = true;
  };
  writeSorted();

  let frame = 0;
  return {
    mesh,
    update(camera, sun) {
      camera.getWorldPosition(camPos);
      sunView.copy(sun).transformDirection(camera.matrixWorldInverse);
      material.uniforms.uSunDirView.value.copy(sunView);
      if (frame++ % 2 === 0) {
        for (let i = 0; i < count; i++) {
          const p = puffs[i];
          const dx = p.x - camPos.x, dy = p.y - camPos.y, dz = p.z - camPos.z;
          dist[i] = dx * dx + dy * dy + dz * dz;
        }
        order.sort((a, b) => dist[b] - dist[a]);
        writeSorted();
      }
    },
    densityAt(p) {
      let d = 0;
      for (const c of clouds) {
        const dx = (p.x - c.x) / (c.rx * 0.8), dy = (p.y - c.y) / (c.ry * 0.85), dz = (p.z - c.z) / (c.rz * 0.8);
        const q = dx * dx + dy * dy + dz * dz;
        if (q < 4) d += Math.exp(-q * 1.8);
      }
      return Math.min(1, d);
    },
    setVisible(v) { mesh.visible = v; },
    dispose() { geo.dispose(); material.dispose(); atlas.dispose(); },
  };
}
