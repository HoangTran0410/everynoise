// Image viewer: tap any song cover or artist photo (img[data-zoom], set by coverEl/avatarEl) to see it full screen.
// Pinch / wheel to zoom (1×–6×) around the finger or cursor, drag to pan, double-tap to toggle 2.5×,
// tap the background, ✕ or Esc to close. The small image shows at once; the 640px one replaces it when loaded.
import { el } from "./util.js";
import { t, addStrings } from "./i18n.js";

addStrings({ "Xem ảnh": "Image viewer", "Đóng": "Close" });

const MIN = 1, MAX = 6;
let dlg, stage, img, cap, s = 1, tx = 0, ty = 0;
const ptrs = new Map();
let pinch = null, drag = null, moved = false, lastTap = 0;

function apply(anim) {
  img.style.transition = anim ? "transform .2s ease" : "none";
  img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  stage.classList.toggle("zoomed", s > 1.01);
}
function clampPan() {
  const r = stage.getBoundingClientRect(), w = img.offsetWidth * s, h = img.offsetHeight * s;
  const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (h - r.height) / 2);
  tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
}
/** Zoom to `ns` keeping the point (cx, cy) (client coords) under the finger. */
function zoomAt(ns, cx, cy, anim) {
  ns = Math.max(MIN, Math.min(MAX, ns));
  const r = stage.getBoundingClientRect();
  const px = cx - (r.left + r.width / 2), py = cy - (r.top + r.height / 2);
  tx = px - (px - tx) * (ns / s); ty = py - (py - ty) * (ns / s);
  s = ns;
  if (s <= 1.01) { s = 1; tx = 0; ty = 0; }
  clampPan(); apply(anim);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function build() {
  img = el("img", { class: "iv-img", alt: "", draggable: "false" });
  cap = el("p", { class: "iv-cap" });
  stage = el("div", { class: "iv-stage" }, img);
  const close = el("button", { class: "icon-btn iv-close", "aria-label": t("Đóng"), onclick: () => dlg.close() });
  close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>';
  dlg = el("dialog", { class: "iv", "aria-label": t("Xem ảnh") }, stage, cap, close);
  document.body.append(dlg);

  stage.addEventListener("pointerdown", (e) => {
    if (e.isPrimary) { ptrs.clear(); pinch = null; }   // a primary pointer means nothing else is down: drop stale ones
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { moved = false; drag = { x: e.clientX, y: e.clientY, tx, ty }; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: dist(a, b), s }; drag = null; moved = true; }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      zoomAt(pinch.s * (dist(a, b) / pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2, false);
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (s > 1) { tx = drag.tx + dx; ty = drag.ty + dy; clampPan(); apply(false); }
    }
  });
  const up = (e) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 1) { const [p] = [...ptrs.values()]; drag = { x: p.x, y: p.y, tx, ty }; return; }
    if (ptrs.size) return;
    drag = null;
    if (moved || e.type === "pointercancel") return;
    const now = Date.now();
    if (now - lastTap < 300) { lastTap = 0; zoomAt(s > 1 ? 1 : 2.5, e.clientX, e.clientY, true); return; }
    lastTap = now;
    // a single tap outside the picture closes (after the double-tap window)
    const onImg = e.target === img;
    if (!onImg && s === 1) setTimeout(() => { if (lastTap === now) dlg.close(); }, 300);
  };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  stage.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(s * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY, false); }, { passive: false });
  dlg.addEventListener("close", () => { img.removeAttribute("src"); ptrs.clear(); pinch = drag = null; });
}

/** Open the viewer: `small` shows at once, `big` swaps in when loaded. */
export function openViewer(big, { small = "", caption = "", round = false } = {}) {
  if (!dlg) build();
  s = 1; tx = 0; ty = 0; apply(false);
  img.classList.toggle("round", round);
  img.src = small || big;
  if (big && big !== small) { const hi = new Image(); hi.onload = () => { if (dlg.open && img.src === (small || big)) img.src = big; }; hi.src = big; }
  cap.textContent = caption; cap.hidden = !caption;
  dlg.showModal();
}

// Any img[data-zoom] opens the viewer, before the row/card it sits in reacts to the tap.
// Not inside game answer buttons (tapping a face there is the answer).
export function initViewer() {
  document.addEventListener("click", (e) => {
    const im = e.target.closest?.("img[data-zoom]");
    if (!im || im.closest(".quiz-opt, .mosaic")) return;
    e.preventDefault(); e.stopPropagation();
    openViewer(im.dataset.zoom, { small: im.currentSrc || im.src, caption: im.dataset.cap || im.alt || "", round: !!im.closest(".avatar") });
  }, true);
}
