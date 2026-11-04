// On-device frame meter, for measuring on a real phone: tap the version in Settings 5 times to toggle.
// Shows fps, slow frames and where the map's time goes, refreshed twice a second. Off by default; costs nothing then.
const KEY = "nm:perfhud";

export function initPerfHud(map, trigger) {
  let on = false, box = null, raf = 0, timer = 0;
  let frames = [], last = 0, base = [], ov = [];
  const wrap = (k, arr) => {
    const orig = map[k];
    map[k] = function (...a) {
      if (!on) return orig.apply(this, a);
      const t0 = performance.now(); const r = orig.apply(this, a); arr().push(performance.now() - t0); return r;
    };
  };
  wrap("_drawBase", () => base); wrap("_drawOverlay", () => ov);
  const mk = map._makeSprite;
  map._makeSprite = function (...a) { if (on && map.stats) map.stats.spr++; return mk.apply(this, a); };

  const tick = (t) => { if (last) frames.push(t - last); last = t; raf = requestAnimationFrame(tick); };
  const q = (a, p) => { if (!a.length) return 0; const x = a.slice().sort((m, n) => m - n); return x[Math.min(x.length - 1, Math.floor(x.length * p))]; };
  const f1 = (v) => v.toFixed(1);
  const show = () => {
    const n = frames.length, sum = frames.reduce((a, b) => a + b, 0);
    const s = map.stats;
    box.textContent =
      `fps ${n ? Math.round(1000 * n / sum) : 0}  slow>33ms ${frames.filter((d) => d > 33).length}  max ${f1(q(frames, 1))}\n` +
      `base ${f1(q(base, .5))}/${f1(q(base, .95))}ms ×${base.length}  over ${f1(q(ov, .5))}/${f1(q(ov, .95))}\n` +
      `dots hit ${s.hit} build ${s.build} direct ${s.direct}  labels+${s.spr}\n` +
      `z ${(map.view.z / map.zRef).toFixed(2)}  dpr ${map.DPR}/${devicePixelRatio}  ${map.base.width}×${map.base.height}`;
    frames = []; base = []; ov = []; map.stats = { hit: 0, build: 0, direct: 0, spr: 0 };
  };
  const set = (v) => {
    on = v;
    try { v ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY); } catch {}
    if (v) {
      box ||= Object.assign(document.createElement("pre"), { className: "perf-hud" });
      document.body.append(box);
      map.stats = { hit: 0, build: 0, direct: 0, spr: 0 };
      last = 0; raf = requestAnimationFrame(tick); timer = setInterval(show, 500);
    } else {
      box?.remove(); cancelAnimationFrame(raf); clearInterval(timer); map.stats = null;
    }
  };
  let taps = [];
  trigger?.addEventListener("click", () => {
    const now = performance.now(); taps = taps.filter((x) => now - x < 2000); taps.push(now);
    if (taps.length >= 5) { taps = []; set(!on); }
  });
  try { if (localStorage.getItem(KEY)) set(true); } catch {}
}
