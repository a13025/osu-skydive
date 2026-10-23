import { useEffect, useRef, useState, useCallback } from 'react';
import { createScene, type SceneHandle, type SceneStatus, type SceneOptions } from './scene/createScene';
import { START_Y, STOP_Y } from './scene/config';

const DEFAULT_OPTIONS: SceneOptions = { godRays: true, bloom: true, flare: true, clouds: true, shadows: true };

const OPTION_LABELS: { key: keyof SceneOptions; label: string; hint: string }[] = [
  { key: 'godRays', label: '体积光', hint: '太阳穿过伞体的丁达尔光束' },
  { key: 'bloom', label: '泛光', hint: '太阳 / 水面 / 云层高光辉光' },
  { key: 'flare', label: '镜头光晕', hint: '程序化鬼影与光环' },
  { key: 'clouds', label: '云层', hint: '可穿越的分层积云' },
  { key: 'shadows', label: '实时阴影', hint: '4K 软阴影贴图' },
];

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SceneStatus>({
    altitude: START_Y, speedKmh: 0, falling: true, landed: false, cloud: 0, fps: 0,
  });
  const [options, setOptions] = useState<SceneOptions>(DEFAULT_OPTIONS);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    let disposed = false;
    // 先让加载遮罩绘制一帧，再执行较重的地形 / 阴影烘焙
    const timer = window.setTimeout(() => {
      if (disposed) return;
      handleRef.current = createScene(el, (s) => setStatus(s));
      (window as unknown as { __skyScene?: SceneHandle }).__skyScene = handleRef.current;
      setReady(true);
    }, 30);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  const toggle = useCallback((key: keyof SceneOptions) => {
    setOptions((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      handleRef.current?.setOptions({ [key]: next[key] });
      return next;
    });
  }, []);

  const progress = Math.max(0, Math.min(1, (START_Y - status.altitude) / (START_Y - STOP_Y)));

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#7db6e8] text-white select-none">
      <div ref={mountRef} className="absolute inset-0" />

      {/* 顶部状态 */}
      <div className="pointer-events-none absolute left-5 top-5 flex flex-col gap-2">
        <div className="hud-panel px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.25em] text-sky-100/70">
            {status.landed ? 'Landed' : 'Altitude'}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums leading-none drop-shadow">
              {Math.round(status.altitude)}
            </span>
            <span className="text-sm text-sky-100/80">m</span>
            {status.falling && (
              <>
                <span className="mx-1 h-4 w-px bg-white/25" />
                <span className="font-mono text-lg tabular-nums">{Math.round(status.speedKmh)}</span>
                <span className="text-xs text-sky-100/80">km/h</span>
              </>
            )}
          </div>
          <div className="mt-2 h-1 w-56 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-200 via-sky-200 to-white transition-[width] duration-150"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] tracking-widest text-sky-100/60">
            <span>{START_Y} m</span>
            <span>{STOP_Y} m</span>
          </div>
        </div>

        <div
          className="hud-panel flex items-center gap-2 px-3 py-1.5 text-xs transition-opacity duration-500"
          style={{ opacity: status.cloud > 0.05 ? 1 : 0 }}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,.9)]" />
          正在穿越云层 · 能见度 {Math.round((1 - status.cloud) * 100)}%
        </div>
      </div>

      {/* 右上：场景说明 + 设置 */}
      <div className="absolute right-5 top-5 flex flex-col items-end gap-2">
        <div className="hud-panel px-4 py-2.5 text-right">
          <div className="text-sm font-semibold tracking-wide">高空坠落 · 冲压翼伞 · osu! 挂坠</div>
          <div className="mt-0.5 text-[11px] text-sky-100/70">
            物理大气天空 · 体积光 · 高度雾 · 烘焙地形阴影 · {Math.round(status.fps)} fps
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="hud-panel cursor-pointer px-3 py-1.5 text-xs tracking-widest transition hover:bg-white/15"
        >
          {panelOpen ? '收起渲染选项 ▲' : '渲染选项 ▼'}
        </button>
        {panelOpen && (
          <div className="hud-panel w-60 p-2">
            {OPTION_LABELS.map(({ key, label, hint }) => (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left transition hover:bg-white/10"
              >
                <div>
                  <div className="text-sm">{label}</div>
                  <div className="text-[10px] text-sky-100/60">{hint}</div>
                </div>
                <span
                  className={`relative inline-block h-5 w-9 rounded-full transition ${
                    options[key] ? 'bg-sky-400' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      options[key] ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 + 重置 */}
      <div className="pointer-events-none absolute bottom-5 left-5 text-[13px] leading-relaxed tracking-wider text-white/90 drop-shadow-[0_1px_6px_rgba(0,30,70,.6)]">
        鼠标拖拽旋转 · 滚轮缩放 · 右键平移
      </div>
      <button
        type="button"
        onClick={() => handleRef.current?.reset()}
        className="absolute bottom-6 right-6 cursor-pointer rounded-xl border-0 bg-gradient-to-br from-[#4aadff] to-[#1a6fd4] px-8 py-3.5 text-[15px] font-semibold tracking-[0.1em] text-white shadow-[0_6px_22px_rgba(20,100,210,.5),inset_0_1px_0_rgba(255,255,255,.35)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(20,100,210,.65),inset_0_1px_0_rgba(255,255,255,.35)] active:translate-y-0"
      >
        重 置
      </button>

      {/* 加载遮罩 */}
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#2d6fc4] via-[#6fb0e8] to-[#b9d8f2] transition-opacity duration-700 ${
          ready ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        <div className="mt-4 text-sm tracking-[0.3em] text-white/90">正在生成地形与光照…</div>
      </div>
    </div>
  );
}
