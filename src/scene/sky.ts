import * as THREE from 'three';

/* =====================================================================
   物理大气天空（Rayleigh + Mie 单次散射，逐像素光线步进）
   - 输出线性 HDR 辐射度：主相机渲染时经后期色调映射；
     同一材质用于 PMREM 环境贴图，使 PBR 反射中带有真实 HDR 太阳
   - 随相机海拔变化（2800m 高空天顶更深邃）
   - 太阳圆盘含边缘变暗，Mie 前向散射形成暖色光晕
   ===================================================================== */

const skyVertex = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = wp.xyz - cameraPosition;
    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
  }
`;

const skyFragment = /* glsl */ `
  precision highp float;
  uniform vec3  uSunDir;
  uniform float uAltitude;
  uniform float uSunIntensity;
  uniform float uSunDiskCos;
  uniform float uSunDiskAng;
  uniform float uSunDiskIntensity;
  uniform vec3  uGroundColor;
  uniform float uCloudFade;
  uniform vec3  uCloudColor;
  uniform float uMieStrength;
  varying vec3 vWorldDir;

  const float PI = 3.14159265359;
  const float R_PLANET = 6371000.0;
  const float R_ATMOS  = 6471000.0;
  const vec3  BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
  const float BETA_M = 2.0e-5;
  const float H_R = 8000.0;
  const float H_M = 1200.0;
  const float G   = 0.78;
  const int STEPS  = 14;
  const int LSTEPS = 6;

  // 射线与原点球相交，返回 (tNear, tFar)
  vec2 rsi(vec3 ro, vec3 rd, float sr) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - sr * sr;
    float d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }

  vec3 atmosphere(vec3 rd, vec3 ro, vec3 sunDir, out vec3 transmittance, out bool hitGround) {
    hitGround = false;
    vec2 pa = rsi(ro, rd, R_ATMOS);
    if (pa.x > pa.y) { transmittance = vec3(1.0); return vec3(0.0); }
    float tMax = pa.y;
    vec2 pg = rsi(ro, rd, R_PLANET);
    if (pg.x > 0.0 && pg.x < pg.y) { tMax = min(tMax, pg.x); hitGround = true; }

    float ds = tMax / float(STEPS);
    float t = 0.0;
    vec3 totR = vec3(0.0), totM = vec3(0.0);
    float odR = 0.0, odM = 0.0;

    float mu = dot(rd, sunDir);
    float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float gg = G * G;
    float phM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (1.0 + mu * mu)) / ((2.0 + gg) * pow(1.0 + gg - 2.0 * G * mu, 1.5));

    for (int i = 0; i < STEPS; i++) {
      vec3 pos = ro + rd * (t + ds * 0.5);
      float h = max(length(pos) - R_PLANET, 0.0);
      float hr = exp(-h / H_R) * ds;
      float hm = exp(-h / H_M) * ds;
      odR += hr; odM += hm;

      float lmax = rsi(pos, sunDir, R_ATMOS).y;
      float lds = lmax / float(LSTEPS);
      float lt = 0.0;
      float lodR = 0.0, lodM = 0.0;
      for (int j = 0; j < LSTEPS; j++) {
        vec3 lp = pos + sunDir * (lt + lds * 0.5);
        float lh = max(length(lp) - R_PLANET, 0.0);
        lodR += exp(-lh / H_R) * lds;
        lodM += exp(-lh / H_M) * lds;
        lt += lds;
      }
      vec3 att = exp(-(BETA_R * (odR + lodR) + BETA_M * 1.1 * (odM + lodM)));
      totR += hr * att;
      totM += hm * att;
      t += ds;
    }
    transmittance = exp(-(BETA_R * odR + BETA_M * 1.1 * odM));
    vec3 single = uSunIntensity * (phR * BETA_R * totR + phM * BETA_M * uMieStrength * totM);
    // 多次散射近似：光学厚度越大，补充越多偏蓝白的环境散射，避免地平线过橙过暗
    float msAmt = 1.0 - exp(-(odR * 1.2e-5 + odM * 4.0e-5));
    vec3 multi = msAmt * vec3(0.46, 0.60, 0.82) * uSunIntensity * 0.05 * clamp(sunDir.y * 2.5 + 0.15, 0.0, 1.0);
    return single + multi;
  }

  void main() {
    vec3 rd = normalize(vWorldDir);
    vec3 ro = vec3(0.0, R_PLANET + max(uAltitude, 2.0), 0.0);
    vec3 trans; bool ground;
    vec3 col = atmosphere(rd, ro, uSunDir, trans, ground);

    if (ground) {
      // 地平线以下：远处被大气浸染的大地
      float ndl = max(uSunDir.y, 0.0);
      col += trans * uGroundColor * uSunIntensity * (0.045 * ndl + 0.012);
    } else {
      // 太阳圆盘 + 边缘变暗
      float cosAng = dot(rd, uSunDir);
      float ang = acos(clamp(cosAng, -1.0, 1.0));
      float r = clamp(ang / uSunDiskAng, 0.0, 1.0);
      float limb = 1.0 - 0.55 * (1.0 - sqrt(max(0.0, 1.0 - r * r)));
      float disk = 1.0 - smoothstep(uSunDiskAng * 0.9, uSunDiskAng * 1.06, ang);
      col += trans * uSunDiskIntensity * disk * limb * vec3(1.0, 0.97, 0.92);
      // 近日晕（Mie 之外额外的柔光，模拟镜头/大气光晕）
      float glow = pow(max(cosAng, 0.0), 180.0) * 0.9 + pow(max(cosAng, 0.0), 24.0) * 0.18;
      col += trans * glow * uSunIntensity * 0.08 * vec3(1.0, 0.9, 0.75);
    }

    // 穿越云层时整体泛白
    col = mix(col, uCloudColor, uCloudFade);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SkySystem {
  dome: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** 更新相机海拔（米） */
  setAltitude(alt: number): void;
  /** 云中泛白程度 0..1 */
  setCloudFade(f: number): void;
  /** 使用当前天空重新生成 PMREM 环境贴图 */
  updateEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void;
  dispose(): void;
}

export function createSky(sunDir: THREE.Vector3, radius = 20000): SkySystem {
  const sunDiskAng = 0.0047; // ≈ 0.27°，真实太阳角半径

  const uniforms = {
    uSunDir: { value: sunDir.clone() },
    uAltitude: { value: 2800 },
    uSunIntensity: { value: 24.0 },
    uSunDiskCos: { value: Math.cos(sunDiskAng) },
    uSunDiskAng: { value: sunDiskAng },
    uSunDiskIntensity: { value: 60.0 },
    uGroundColor: { value: new THREE.Color('#5f7458') },
    uCloudFade: { value: 0 },
    uCloudColor: { value: new THREE.Color(1.15, 1.17, 1.2) },
    uMieStrength: { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });

  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), material);
  dome.renderOrder = -10;
  dome.frustumCulled = false;

  // 环境贴图专用：较大的太阳圆盘（稍微分摊亮度），便于低分辨率立方体贴图采样到高光
  const envMaterial = material.clone();
  envMaterial.uniforms = THREE.UniformsUtils.clone(uniforms);
  envMaterial.uniforms.uSunDiskAng.value = 0.022;
  envMaterial.uniforms.uSunDiskIntensity.value = 18.0;
  envMaterial.uniforms.uCloudFade.value = 0;
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 32), envMaterial));

  let pmrem: THREE.PMREMGenerator | null = null;
  let envRT: THREE.WebGLRenderTarget | null = null;

  return {
    dome,
    material,
    setAltitude(alt) {
      uniforms.uAltitude.value = alt;
      envMaterial.uniforms.uAltitude.value = alt;
    },
    setCloudFade(f) {
      uniforms.uCloudFade.value = f;
    },
    updateEnvironment(renderer, scene) {
      if (!pmrem) {
        pmrem = new THREE.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
      }
      const old = envRT;
      envRT = pmrem.fromScene(envScene, 0, 1, 1000);
      scene.environment = envRT.texture;
      if (old) old.dispose();
    },
    dispose() {
      dome.geometry.dispose();
      material.dispose();
      envMaterial.dispose();
      envRT?.dispose();
      pmrem?.dispose();
    },
  };
}
