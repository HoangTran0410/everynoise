// One-line, kid-friendly explanation of the selected genre (#d-explain in the detail panel).
// data/explain.json is fetched lazily once; the sentence is composed by js/explain-core.js.
import { model } from "./data.js";
import { lang } from "./i18n.js";
import { parseExplain, compose } from "./explain-core.js";

let X = null, loading = null, current = -1;

function load() {
  if (!loading) {
    loading = fetch("data/explain.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("explain.json " + r.status))))
      .then((j) => { X = parseExplain(j); return X; })
      .catch((e) => { console.warn(e); loading = null; return null; });
  }
  return loading;
}

export function sentence(i, l = lang) {
  const g = model.G[i];
  if (!X || !g) return "";
  return compose(X, g, i, l);
}

function paint() {
  const p = document.getElementById("d-explain");
  if (!p) return;
  if (current < 0) { p.textContent = ""; return; }
  p.textContent = sentence(current);
  p.hidden = !p.textContent;
}

// Call from the detail panel every time a genre is selected.
export function showExplain(i) {
  current = i;
  paint();
  if (!X) load().then(() => { if (current === i) paint(); });
}

addEventListener("langchange", paint);
window.__explain = { sentence: (i, l) => sentence(i, l || lang), ready: () => load().then(() => true) };
