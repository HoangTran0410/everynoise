// Round play/pause button with a live mini visualizer behind the icon (same look as the player artwork:
// pulsing disc + radial bars). It reads the shared analysis object `player.fxa`; game audio is tapped
// into the player's analyser when the CDN allows CORS (player.gameSrc), otherwise fxa runs its simulation.
// One rAF loop per button, only while its dialog is open and something plays (or the bars are still falling).
import { cover } from "./util.js";
const TAU = Math.PI * 2;

/** btn: the <button>; dlg: its dialog; audio: a game <audio> (omit = the main player). */
export function initVizBtn(btn, { player, dlg, audio = null }) {
  const cv = document.createElement("canvas");
  cv.className = "vb-cv";
  cv.setAttribute("aria-hidden", "true");
  btn.prepend(cv);
  btn.classList.add("vb");
  let on = false, size = 0, dpr = 1;
  const playing = () => (audio ? !audio.paused && !audio.ended : player.playing);

  function fit() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = btn.clientWidth;
    if (s && s !== size) { size = s; cv.width = cv.height = Math.round(s * dpr); }
  }

  function draw(t) {
    const ctx = cv.getContext("2d"), W = cv.width, c = W / 2, a = player.fxa, beat = a.beat;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = ctx.strokeStyle = "#fff";
    const base = W * 0.25 * (1 + beat * 0.2 + a.bass * 0.1), nb = 24;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(t / 9000);
    ctx.lineCap = "round";
    ctx.lineWidth = W * 0.032;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let i = 0; i < nb; i++) {
      const k = Math.floor((i < nb / 2 ? i : nb - 1 - i) * (a.n * 0.55) / (nb / 2));   // bass top+bottom, highs on the sides
      const ang = (i / nb) * TAU, s = Math.sin(ang), co = -Math.cos(ang);
      const r0 = base + W * 0.03, r1 = r0 + W * 0.025 + a.bands[k] * W * 0.15;
      ctx.moveTo(s * r0, co * r0); ctx.lineTo(s * r1, co * r1);
    }
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 0.16 + beat * 0.26;
    ctx.beginPath(); ctx.arc(c, c, base, 0, TAU); ctx.fill();   // no gradients/shadowBlur: flat discs
    ctx.globalAlpha = 1;
  }

  function loop(t) {
    if (!dlg.open || cover.away) { on = false; return; }
    player.vizTick(t);
    draw(t);
    if (playing() || player.fxa.energy > 0.005 || player.fxa.beat > 0.01) requestAnimationFrame(loop);
    else on = false;
  }

  function start() {
    if (on || !dlg.open || cover.away) return;
    on = true; fit();
    requestAnimationFrame(loop);
  }
  if (audio) audio.addEventListener("play", start);
  else player.on("state", (p) => p && start());
  addEventListener("resize", () => { if (dlg.open) { fit(); start(); } });
  addEventListener("awaychange", (ev) => { if (!ev.detail) start(); });   // back in front: redraw (stops itself if silent)
  return { start };
}
