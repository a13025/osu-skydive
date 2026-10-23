import * as THREE from 'three';
import { FOG_BASE_Y, FOG_HEIGHT_SCALE } from './config';

/* =====================================================================
   大气透视雾（全局替换 three 的 fog 着色器块）
   - 指数高度雾：山谷里雾气更浓，越往高空越清澈（解析积分，无需步进）
   - 方向性散射：朝向太阳的雾气泛暖金色，背向太阳偏蓝
   - 由于直接替换 ShaderChunk，场景中所有材质（含伞绳 LineBasicMaterial）
     自动获得一致的大气效果，无需修改任何物体材质
   ===================================================================== */

const f = (n: number) => n.toFixed(5);

export function installAtmosphericFog(sunDir: THREE.Vector3) {
  const sd = `vec3(${f(sunDir.x)}, ${f(sunDir.y)}, ${f(sunDir.z)})`;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogViewPos;
#endif`;

  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogViewPos = mvPosition.xyz;
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogViewPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  const vec3  FOG_SUN_DIR   = ${sd};
  const vec3  FOG_SUN_TINT  = vec3(1.0, 0.80, 0.52);
  const float FOG_H_K       = ${f(1 / FOG_HEIGHT_SCALE)};
  const float FOG_H_BASE    = ${f(FOG_BASE_Y)};
  // 沿视线对 exp(-k*h) 密度做解析积分（返回平均密度系数）
  float fogHeightIntegral(float h0, float h1) {
    float dh = h1 - h0;
    float e0 = exp(-FOG_H_K * h0);
    if (abs(dh) < 0.5) return e0;
    float e1 = exp(-FOG_H_K * h1);
    return (e0 - e1) / (FOG_H_K * dh);
  }
#endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogDist = length(vFogViewPos);
  vec3 fogDir = normalize((vec4(vFogViewPos, 0.0) * viewMatrix).xyz);
  float fogCamH  = cameraPosition.y - FOG_H_BASE;
  float fogFragH = fogCamH + fogDir.y * fogDist;
  #ifdef FOG_EXP2
    float fogOD = fogDensity * fogDist * fogHeightIntegral(fogCamH, fogFragH);
    float fogFactor = 1.0 - exp(-fogOD);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, fogDist);
  #endif
  float fogSunAmt = max(dot(fogDir, FOG_SUN_DIR), 0.0);
  vec3 fogCol = fogColor * (1.0 + 0.25 * pow(fogSunAmt, 4.0))
              + FOG_SUN_TINT * (0.30 * pow(fogSunAmt, 8.0) + 0.9 * pow(fogSunAmt, 64.0));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogFactor, 0.0, 1.0));
#endif`;
}
