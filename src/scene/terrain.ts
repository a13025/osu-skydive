import * as THREE from 'three';
import { makeNoise2D, fbm, smoothstep } from './utils';

/* =====================================================================
   地形 + 河流 + 远山
   - 内圈 6km（保留原版高度场 / 河流 / 配色）
   - 外圈 26km 远山环，消除原版“悬浮方形岛”的地平线
   - 按真实太阳方向逐顶点光线步进烘焙软阴影 + 环境光遮蔽，
     通过 onBeforeCompile 仅作用于直接光 / 间接光项（不污染反照率）
   - 平铺细节贴图 + 法线贴图，近地面不再平滑发腻
   ===================================================================== */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/* ---------- 可平铺噪声（周期格点值噪声） ---------- */
function tileableNoise(size: number, period: number, octaves: number, seed: number) {
  const out = new Float32Array(size * size);
  const hash = (i: number, j: number, o: number) => {
    let h = (i * 374761393 + j * 668265263 + o * 2246822519 + seed * 3266489917) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const fade = (t: number) => t * t * (3 - 2 * t);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) norm += amp, amp *= 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0; amp = 1;
      let p = period;
      for (let o = 0; o < octaves; o++) {
        const fx = (x / size) * p, fy = (y / size) * p;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fade(fx - ix), ty = fade(fy - iy);
        const i0 = ix % p, i1 = (ix + 1) % p, j0 = iy % p, j1 = (iy + 1) % p;
        const a = hash(i0, j0, o), b = hash(i1, j0, o), c = hash(i0, j1, o), d = hash(i1, j1, o);
        v += amp * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
        amp *= 0.5; p *= 2;
      }
      out[y * size + x] = v / norm;
    }
  }
  return out;
}

function makeDetailTextures() {
  const S = 256;
  const h = tileableNoise(S, 6, 5, 7);
  const h2 = tileableNoise(S, 3, 4, 19);
  const col = new Uint8Array(S * S * 4);
  const nrm = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = 0.82 + 0.30 * (h[i] * 0.65 + h2[i] * 0.35);
      const g = Math.round(clamp01(v) * 255);
      col[i * 4] = g; col[i * 4 + 1] = g; col[i * 4 + 2] = g; col[i * 4 + 3] = 255;
      const hl = h[y * S + ((x + S - 1) % S)], hr = h[y * S + ((x + 1) % S)];
      const hd = h[((y + S - 1) % S) * S + x], hu = h[((y + 1) % S) * S + x];
      const nx = (hl - hr) * 3.0, ny = (hd - hu) * 3.0;
      const len = Math.hypot(nx, ny, 1);
      nrm[i * 4] = Math.round((nx / len * 0.5 + 0.5) * 255);
      nrm[i * 4 + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
      nrm[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      nrm[i * 4 + 3] = 255;
    }
  }
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { colorMap: mk(col, true), normalMap: mk(nrm, false) };
}

function makeWaterNormalMap() {
  const S = 256;
  const a = tileableNoise(S, 5, 4, 101);
  const b = tileableNoise(S, 9, 3, 202);
  const data = new Uint8Array(S * S * 4);
  const H = (x: number, y: number) => {
    const i = ((y + S) % S) * S + ((x + S) % S);
    return a[i] * 0.6 + b[i] * 0.4;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const nx = (H(x - 1, y) - H(x + 1, y)) * 4.0, ny = (H(x, y - 1) - H(x, y + 1)) * 4.0;
    const len = Math.hypot(nx, ny, 1);
    data[i * 4] = Math.round((nx / len * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/* ---------- 原版配色（保留），略微压暗远山并增加岩石冷色 ---------- */
function terrainColor(h: number, slope: number, x: number, z: number, noise: (x: number, y: number) => number, rampScale = 1) {
  const c = new THREE.Color();
  const hRelReal = h + 230;
  const hRel = hRelReal * rampScale;
  if (hRel < 10) {
    c.setRGB(0.14, 0.34, 0.09);
  } else if (hRel < 55) {
    const t = (hRel - 10) / 45;
    c.setRGB(0.14 + t * 0.14, 0.34 + t * 0.16, 0.09 + t * 0.08);
  } else if (hRel < 130) {
    const t = (hRel - 55) / 75;
    c.setRGB(0.28 + t * 0.12, 0.50 + t * 0.08, 0.17 + t * 0.06);
  } else if (hRel < 260) {
    const t = (hRel - 130) / 130;
    c.setRGB(0.40 - t * 0.04, 0.58 - t * 0.08, 0.23 + t * 0.10);
  } else if (hRel < 480) {
    const t = (hRel - 260) / 220;
    c.setRGB(0.36 + t * 0.16, 0.50 + t * 0.14, 0.33 + t * 0.10);
  } else {
    const t = Math.min(1, (hRel - 480) / 240);
    c.setRGB(0.52 + t * 0.42, 0.64 + t * 0.32, 0.43 + t * 0.50);
  }
  const rockAmt = smoothstep(0.38, 0.72, slope);
  if (rockAmt > 0) c.lerp(new THREE.Color(0.40, 0.35, 0.31), rockAmt * 0.9);
  // 远山偏冷的岩石 / 高山草甸色
  if (rampScale < 1) c.lerp(new THREE.Color(0.36, 0.40, 0.36), (1 - rampScale) * 0.5);
  // 仅真实海拔很高的峰顶积雪
  const snow = smoothstep(1350, 1750, hRelReal) * (1 - smoothstep(0.45, 0.8, slope));
  if (snow > 0) c.lerp(new THREE.Color(0.92, 0.95, 1.0), snow);
  const shade = fbm(noise, x * 0.00035 + 1000, z * 0.00035 + 1000, 2) * 0.5 + 0.5;
  c.multiplyScalar(0.92 + shade * 0.10);
  return c;
}

/* ---------- 烘焙阴影注入 ---------- */
function applyBakeInjection(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aBake;\nvarying vec2 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = aBake;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBake;')
      .replace(
        '#include <lights_fragment_begin>',
        '#include <lights_fragment_begin>\nreflectedLight.directDiffuse *= vBake.x;\nreflectedLight.directSpecular *= vBake.x;',
      )
      .replace(
        '#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vBake.y;\nreflectedLight.indirectSpecular *= mix(1.0, vBake.y, 0.6);',
      );
  };
  mat.customProgramCacheKey = () => 'terrain-bake';
}

export interface TerrainSystem {
  group: THREE.Group;
  water: THREE.Mesh;
  /** 采样地形高度（世界坐标） */
  heightAt(x: number, z: number): number;
  update(dt: number): void;
}

export function buildTerrain(sunDir: THREE.Vector3): TerrainSystem {
  const noise = makeNoise2D(42317);

  /* ---------- 高度函数（内圈与原版完全一致 + 远山） ---------- */
  const baseHeight = (x: number, z: number) => {
    const dist = Math.sqrt(x * x + z * z);
    const hill = (fbm(noise, x * 0.0010, z * 0.0010, 3) * 0.5 + 0.5) * 72;
    const mid = (fbm(noise, x * 0.0028, z * 0.0028, 2) * 0.5 + 0.5) * 10;
    const mMask = smoothstep(900, 2500, dist);
    const mBase = (fbm(noise, x * 0.00040, z * 0.00040, 3) * 0.5 + 0.5) * 520;
    const ridge = Math.pow(1 - Math.abs(fbm(noise, x * 0.00070, z * 0.00070, 2)), 2.2) * 300;
    const mountain = (mBase + ridge) * mMask;
    // 远山：3.2km 之外逐渐抬升为高大山脉
    const fMask = smoothstep(3200, 9000, dist);
    const fBase = (fbm(noise, x * 0.00016 + 50, z * 0.00016 + 50, 4) * 0.5 + 0.5) * 1150;
    const fRidge = Math.pow(1 - Math.abs(fbm(noise, x * 0.00030 + 9, z * 0.00030 + 9, 3)), 2.6) * 520;
    const far = (fBase + fRidge) * fMask;
    return -230 + hill + mid + mountain + far;
  };

  /* ---------- 内圈网格 ---------- */
  const SIZE = 6000, SEG = 300, STEP = SIZE / SEG;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const N = posAttr.count;
  const heights = new Float32Array(N);
  for (let i = 0; i < N; i++) heights[i] = baseHeight(posAttr.getX(i), posAttr.getZ(i));

  const sampleInner = (x: number, z: number) => {
    const fx = Math.max(0, Math.min(SEG - 1e-4, (x + SIZE / 2) / STEP));
    const fz = Math.max(0, Math.min(SEG - 1e-4, (z + SIZE / 2) / STEP));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const i00 = iz * (SEG + 1) + ix;
    const h00 = heights[i00], h10 = heights[i00 + 1], h01 = heights[i00 + SEG + 1], h11 = heights[i00 + SEG + 2];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };
  const sampleNearest = (x: number, z: number) => {
    const ix = Math.max(0, Math.min(SEG, Math.round((x + SIZE / 2) / STEP)));
    const iz = Math.max(0, Math.min(SEG, Math.round((z + SIZE / 2) / STEP)));
    return heights[iz * (SEG + 1) + ix];
  };

  /* ---------- 河流（原版逻辑） ---------- */
  const riverCtrl = [
    new THREE.Vector3(-2200, 0, 900), new THREE.Vector3(-1300, 0, 300), new THREE.Vector3(-520, 0, -420),
    new THREE.Vector3(280, 0, 220), new THREE.Vector3(1100, 0, -380), new THREE.Vector3(2100, 0, 780),
  ];
  const riverCurve = new THREE.CatmullRomCurve3(riverCtrl);
  const riverSamples = riverCurve.getPoints(400);
  const riverY = new Float32Array(riverSamples.length);
  for (let i = 0; i < riverSamples.length; i++) riverY[i] = sampleNearest(riverSamples[i].x, riverSamples[i].z) - 1.0;
  for (let pass = 0; pass < 16; pass++)
    for (let i = 1; i < riverY.length - 1; i++) riverY[i] = (riverY[i - 1] + riverY[i] * 2 + riverY[i + 1]) / 4;

  const RIVER_INFLUENCE = 80, RIVER_DEPTH = 4.0;
  const riverMask = new Float32Array(N);
  // 空间哈希加速最近河点查询
  const cell = 160;
  const buckets = new Map<string, number[]>();
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  riverSamples.forEach((p, k) => {
    const cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
    const kk = key(cx, cz);
    if (!buckets.has(kk)) buckets.set(kk, []);
    buckets.get(kk)!.push(k);
  });
  for (let i = 0; i < N; i++) {
    const x = posAttr.getX(i), z = posAttr.getZ(i);
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let bestD2 = Infinity, bestIdx = -1;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const b = buckets.get(key(cx + dx, cz + dz));
      if (!b) continue;
      for (const k of b) {
        const ddx = x - riverSamples[k].x, ddz = z - riverSamples[k].z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < bestD2) { bestD2 = d2; bestIdx = k; }
      }
    }
    if (bestIdx < 0) continue;
    const d = Math.sqrt(bestD2);
    if (d < RIVER_INFLUENCE) {
      const t = d / RIVER_INFLUENCE;
      const blend = 1 - smoothstep(0, 1, Math.pow(t, 0.7));
      const bedY = riverY[bestIdx] - RIVER_DEPTH;
      if (heights[i] > bedY) heights[i] = heights[i] * (1 - blend) + bedY * blend;
      riverMask[i] = blend;
    }
  }
  for (let i = 0; i < N; i++) posAttr.setY(i, heights[i]);
  geo.computeVertexNormals();

  /* ---------- 外圈远山环 ---------- */
  const OSIZE = 26000, OSEG = 208, OSTEP = OSIZE / OSEG, HOLE = 2880;
  const oPos: number[] = [], oIdx: number[] = [], oUv: number[] = [];
  const oHeights = new Float32Array((OSEG + 1) * (OSEG + 1));
  for (let iz = 0; iz <= OSEG; iz++) for (let ix = 0; ix <= OSEG; ix++) {
    const x = -OSIZE / 2 + ix * OSTEP, z = -OSIZE / 2 + iz * OSTEP;
    const inHole = Math.abs(x) < SIZE / 2 && Math.abs(z) < SIZE / 2;
    // 与内圈重叠区域略微下沉，避免接缝穿插
    const h = inHole ? sampleInner(x, z) - 6 : baseHeight(x, z);
    oHeights[iz * (OSEG + 1) + ix] = h;
    oPos.push(x, h, z);
    oUv.push(ix / OSEG, iz / OSEG);
  }
  for (let iz = 0; iz < OSEG; iz++) for (let ix = 0; ix < OSEG; ix++) {
    const cx = -OSIZE / 2 + (ix + 0.5) * OSTEP, cz = -OSIZE / 2 + (iz + 0.5) * OSTEP;
    if (Math.abs(cx) < HOLE && Math.abs(cz) < HOLE) continue;
    const a = iz * (OSEG + 1) + ix, b = a + 1, c = a + OSEG + 1, d = c + 1;
    oIdx.push(a, c, b, b, c, d);
  }
  const oGeo = new THREE.BufferGeometry();
  oGeo.setAttribute('position', new THREE.Float32BufferAttribute(oPos, 3));
  oGeo.setAttribute('uv', new THREE.Float32BufferAttribute(oUv, 2));
  oGeo.setIndex(oIdx);
  oGeo.computeVertexNormals();

  const sampleOuter = (x: number, z: number) => {
    const fx = Math.max(0, Math.min(OSEG - 1e-4, (x + OSIZE / 2) / OSTEP));
    const fz = Math.max(0, Math.min(OSEG - 1e-4, (z + OSIZE / 2) / OSTEP));
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const i00 = iz * (OSEG + 1) + ix;
    const h00 = oHeights[i00], h10 = oHeights[i00 + 1], h01 = oHeights[i00 + OSEG + 1], h11 = oHeights[i00 + OSEG + 2];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };
  const heightAt = (x: number, z: number) =>
    Math.abs(x) < SIZE / 2 && Math.abs(z) < SIZE / 2 ? sampleInner(x, z) : sampleOuter(x, z);

  /* ---------- 烘焙：太阳可见度（软阴影）+ 环境光遮蔽 ---------- */
  const sx = sunDir.x, sy = sunDir.y, sz = sunDir.z;
  const sunVis = (x: number, y: number, z: number, coarse: boolean) => {
    let vis = 1;
    let d = coarse ? 60 : 14;
    const maxD = coarse ? 9000 : 3600;
    while (d < maxD) {
      const px = x + sx * d, pz = z + sz * d, py = y + 2 + sy * d;
      const h = heightAt(px, pz);
      const occ = smoothstep(-4, 14 + d * 0.012, h - py);
      if (occ > 0) vis = Math.min(vis, 1 - occ);
      if (vis <= 0.02) return 0;
      d *= 1.06; d += coarse ? 30 : 6;
    }
    return vis;
  };
  const ambientOcc = (x: number, y: number, z: number, scale: number) => {
    let sum = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      let e = 0;
      for (const r of [50 * scale, 150 * scale, 400 * scale]) {
        e = Math.max(e, clamp01((heightAt(x + dx * r, z + dz * r) - y) / r));
      }
      sum += e;
    }
    return 1 - clamp01((sum / 8) * 1.1);
  };

  const bakeAttr = (g: THREE.BufferGeometry, coarse: boolean) => {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = p.count;
    const bake = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      bake[i * 2] = sunVis(x, y, z, coarse);
      bake[i * 2 + 1] = 0.45 + 0.55 * ambientOcc(x, y, z, coarse ? 3 : 1);
    }
    g.setAttribute('aBake', new THREE.BufferAttribute(bake, 2));
  };
  bakeAttr(geo, false);
  bakeAttr(oGeo, true);

  /* ---------- 顶点色 ---------- */
  const colorize = (g: THREE.BufferGeometry, mask: Float32Array | null, far = false) => {
    const p = g.attributes.position as THREE.BufferAttribute;
    const nrm = g.attributes.normal as THREE.BufferAttribute;
    const n = p.count;
    const colors = new Float32Array(n * 3);
    const sand = new THREE.Color(0.62, 0.56, 0.40);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), h = p.getY(i), z = p.getZ(i);
      const slope = Math.max(0, 1 - nrm.getY(i));
      // 外圈：随距离把配色梯度压缩，远山不再整片发白（与内圈边界平滑过渡）
      const rampScale = far ? 1 - 0.68 * smoothstep(2900, 6500, Math.hypot(x, z)) : 1;
      const c = terrainColor(h, slope, x, z, noise, rampScale);
      if (mask && mask[i] > 0.3) c.lerp(sand, Math.min(1, (mask[i] - 0.3) * 1.2));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  };
  colorize(geo, riverMask);
  colorize(oGeo, null, true);

  /* ---------- 材质 ---------- */
  const { colorMap, normalMap } = makeDetailTextures();
  colorMap.repeat.set(260, 260);
  normalMap.repeat.set(260, 260);

  const innerMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: colorMap,
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.92,
    metalness: 0.0,
    envMapIntensity: 0.45,
  });
  applyBakeInjection(innerMat);
  const terrain = new THREE.Mesh(geo, innerMat);
  terrain.receiveShadow = true;

  const outerMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    envMapIntensity: 0.4,
  });
  applyBakeInjection(outerMat);
  const outer = new THREE.Mesh(oGeo, outerMat);
  outer.receiveShadow = false;

  /* ---------- 河水 ---------- */
  const wPositions: number[] = [], wUvs: number[] = [], wIndices: number[] = [];
  for (let i = 0; i < riverSamples.length; i++) {
    const t = i / (riverSamples.length - 1);
    const p = riverSamples[i];
    const pNext = riverSamples[Math.min(i + 1, riverSamples.length - 1)];
    const pPrev = riverSamples[Math.max(i - 1, 0)];
    const tx = pNext.x - pPrev.x, tz = pNext.z - pPrev.z;
    const len = Math.hypot(tx, tz) || 1;
    const nx = -tz / len, nz = tx / len;
    const w = 30 * (0.55 + 0.45 * Math.sin(t * Math.PI + 0.3));
    wPositions.push(p.x + nx * w, riverY[i] + 0.12, p.z + nz * w);
    wPositions.push(p.x - nx * w, riverY[i] + 0.12, p.z - nz * w);
    wUvs.push(0, t * 50); wUvs.push(1, t * 50);
  }
  for (let i = 0; i < riverSamples.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    wIndices.push(a, c, b, b, c, d);
  }
  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPositions, 3));
  wGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUvs, 2));
  wGeo.setIndex(wIndices);
  wGeo.computeVertexNormals();

  const waterNormal = makeWaterNormalMap();
  waterNormal.repeat.set(3, 420);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#13456f'),
    metalness: 0.0,
    roughness: 0.07,
    envMapIntensity: 1.5,
    normalMap: waterNormal,
    normalScale: new THREE.Vector2(0.28, 0.28),
    clearcoat: 0.5,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.96,
  });
  const water = new THREE.Mesh(wGeo, waterMat);
  water.receiveShadow = true;

  const group = new THREE.Group();
  group.add(terrain, outer, water);

  return {
    group,
    water,
    heightAt,
    update(dt) {
      waterNormal.offset.x += dt * 0.012;
      waterNormal.offset.y += dt * 0.03;
    },
  };
}
