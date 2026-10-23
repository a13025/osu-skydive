import { Effect, BlendFunction, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2, Vector3, Camera } from 'three';

/* =====================================================================
   程序化镜头光晕（屏幕空间后期 Effect）
   - 太阳核心辉光 + 横向变形光斑 + 色散鬼影 + 彩色光环
   - 采样深度缓冲做遮挡：被伞体 / 地形挡住时平滑消失
   ===================================================================== */

const fragment = /* glsl */ `
  uniform vec2 uSunPos;
  uniform float uVisible;
  uniform float uIntensity;

  float ghost(vec2 uv, vec2 pos, float size, float power) {
    float d = length(uv - pos) / size;
    return pow(max(0.0, 1.0 - d), power);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    // 深度遮挡：围绕太阳位置取 12 个样点
    float occ = 0.0;
    vec2 sp = uSunPos;
    bool onScreen = sp.x > -0.05 && sp.x < 1.05 && sp.y > -0.05 && sp.y < 1.05;
    if (onScreen) {
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5236;
        vec2 o = vec2(cos(a), sin(a)) * vec2(0.008, 0.008 * aspect);
        vec2 s = clamp(sp + o, vec2(0.001), vec2(0.999));
        occ += step(readDepth(s), 0.99999);
      }
      occ /= 12.0;
    } else {
      occ = 1.0;
    }
    float vis = uVisible * (1.0 - occ) * uIntensity;
    if (vis <= 0.001) { outputColor = vec4(0.0); return; }

    // 以屏幕中心为原点、修正纵横比的坐标
    vec2 c = (uv - 0.5) * vec2(aspect, 1.0);
    vec2 p = (sp - 0.5) * vec2(aspect, 1.0);
    vec2 d = c - p;
    float dist = length(d);

    vec3 col = vec3(0.0);
    // 核心辉光
    float core = 1.0 / (dist * 30.0 + 1.0);
    core = pow(core, 2.0);
    col += vec3(1.0, 0.93, 0.82) * core * 0.55;
    // 变形横向光斑
    float streak = exp(-abs(d.y) * 60.0) * exp(-abs(d.x) * 1.9);
    col += vec3(0.85, 0.9, 1.0) * streak * 0.22;
    // 轻微光芒（旋转放射）
    float ang = atan(d.y, d.x);
    float rays = pow(abs(sin(ang * 6.0 + 0.6)), 24.0) * exp(-dist * 4.5) * 0.18;
    col += vec3(1.0, 0.95, 0.85) * rays;

    // 鬼影（沿太阳—中心轴反向分布，带色散）
    vec2 axis = -p;
    float ch = 0.012;
    col.r += ghost(c, p + axis * 0.45, 0.085, 2.0) * 0.16 + ghost(c, p + axis * (0.45 + ch), 0.085, 2.0) * 0.0;
    col.g += ghost(c, p + axis * (0.45 + ch), 0.085, 2.0) * 0.16;
    col.b += ghost(c, p + axis * (0.45 + 2.0 * ch), 0.085, 2.0) * 0.16;

    col += vec3(0.95, 0.65, 0.95) * ghost(c, p + axis * 0.75, 0.055, 2.5) * 0.14;
    col += vec3(0.6, 0.9, 1.0) * ghost(c, p + axis * 1.05, 0.14, 1.6) * 0.12;
    col += vec3(1.0, 0.9, 0.6) * ghost(c, p + axis * 1.35, 0.04, 2.0) * 0.18;
    col += vec3(0.7, 1.0, 0.8) * ghost(c, p + axis * 1.62, 0.09, 2.0) * 0.10;
    col += vec3(1.0, 0.75, 0.7) * ghost(c, p + axis * 1.9, 0.19, 1.3) * 0.08;

    // 远离屏幕中心略衰减，避免角落堆积
    col *= vis;
    outputColor = vec4(col, 1.0);
  }
`;

export class LensFlareEffect extends Effect {
  private readonly camera: Camera;
  private readonly sunDir: Vector3;
  private readonly tmp = new Vector3();

  constructor(camera: Camera, sunDir: Vector3) {
    super('LensFlareEffect', fragment, {
      blendFunction: BlendFunction.ADD,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uSunPos', new Uniform(new Vector2(0.5, 0.5))],
        ['uVisible', new Uniform(0)],
        ['uIntensity', new Uniform(1)],
      ]),
    });
    this.camera = camera;
    this.sunDir = sunDir;
  }

  set intensity(v: number) {
    (this.uniforms.get('uIntensity') as Uniform).value = v;
  }

  update(): void {
    const cam = this.camera;
    // 太阳方向 → 屏幕坐标
    const dirView = this.tmp.copy(this.sunDir).transformDirection(cam.matrixWorldInverse);
    const visU = this.uniforms.get('uVisible') as Uniform;
    const posU = this.uniforms.get('uSunPos') as Uniform;
    if (dirView.z >= -0.02) {
      visU.value = 0;
      return;
    }
    const p = this.tmp.copy(cam.position).addScaledVector(this.sunDir, 5000).project(cam);
    const sx = p.x * 0.5 + 0.5, sy = p.y * 0.5 + 0.5;
    (posU.value as Vector2).set(sx, sy);
    const edge = Math.min(sx, 1 - sx, sy, 1 - sy);
    visU.value = Math.max(0, Math.min(1, (edge + 0.12) / 0.2));
  }
}
