// Pure sentence composer for the one-line genre explanations (no DOM, no imports: also used by node tests).
// Data comes from data/explain.json (built by scripts/build_explain.mjs).

// Parse the JSON once: per-genre records "id,id,..|..." become arrays of term ids.
export function parseExplain(json) {
  return { T: json.T, F: json.F, C: json.C, ax: json.ax, recs: json.R.split("|").map((s) => (s ? s.split(",").map((x) => parseInt(x, 36)) : [])) };
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
  .replace(/^R&b\b/, "R&B");
// English country names that need "the" ("from the USA")
const THE = { USA: "the USA", UK: "the UK", Netherlands: "the Netherlands", Philippines: "the Philippines", Bahamas: "the Bahamas", Nordics: "the Nordic countries", Balkans: "the Balkans", "Arab world": "the Arab world", "Faroe Islands": "the Faroe Islands", "Dominican Republic": "the Dominican Republic", "DR Congo": "DR Congo", Gambia: "The Gambia", "Latin America": "Latin America", Kurdistan: "Kurdistan" };

// Map axes (same normalisation as js/data.js): b = x/1500, dense & atmospheric (0) → spiky & bouncy (1);
// e = organic (0) → mechanical & electric (1). The x axis is sound texture, not energy: punk and death metal sit
// on the dense side. Only the outer fifths get a word; the middle says nothing rather than something vague.
const TEXTURE = {
  vi: ["âm thanh dày, bao trùm", "âm thanh gọn, nảy, dễ nhún nhảy"],
  en: ["a dense, wall-of-sound feel", "a crisp, bouncy sound you can bop to"],
};
const ACOUSTIC = {
  vi: ["chủ yếu nhạc cụ mộc", "chủ yếu âm thanh điện tử"],
  en: ["mostly acoustic instruments", "mostly electronic sounds"],
};
const B_LO = 0.22, B_HI = 0.66, E_LO = 0.33, E_HI = 0.76;   // ≈ 20th / 80th percentiles of the map
// a parent that is just the genre name without "music" says nothing
const FILLER = /\b(music|musica|musique|muzica|musik|muziek|muzyka|songs?)\b/g;
const STOP_PARENT = (g) => g.n.replace(FILLER, "").replace(/\s+/g, " ").trim() === g.p[0];

// g: { n, co, f, s, p, e, b } (a model genre); X: parseExplain() result; lang: "vi" | "en".
export function compose(X, g, i, lang) {
  const vi = lang === "vi";
  const terms = (X.recs[i] || []).map((id) => X.T[id]).filter(Boolean);
  const L = vi ? 1 : 2;                       // index of the language text inside a term
  const heads = terms.filter((t) => t[0] === "n");
  const head = heads[heads.length - 1];
  const sec = heads.length > 1 ? heads[heads.length - 2] : null;
  const mod = terms.find((t) => t[0] === "m");
  const lng = terms.find((t) => t[0] === "l");
  const insts = terms.filter((t) => t[0] === "i");
  const fam0 = g.f && g.f[0] && X.F[g.f[0]];

  let headText, fromTerm = true;
  let inst = insts[0];
  if (head) headText = head[L];
  else if (inst) { headText = vi ? "nhạc chơi bằng " + inst[1] : "music played on " + inst[2]; inst = insts[1]; }
  else if (fam0) { headText = vi ? "một nhánh của " + fam0[2] : "a branch of " + fam0[3]; fromTerm = false; }
  else if (g.p && g.p[0] && !STOP_PARENT(g)) { headText = vi ? `một nhánh con của thể loại “${g.p[0]}”` : `a branch of the “${g.p[0]}” genre`; fromTerm = false; }
  else { headText = vi ? "một thể loại nhạc có phong cách riêng trên bản đồ âm nhạc" : "a music genre with a style all of its own"; fromTerm = false; }

  const parts = {
    sec: sec && sec[L + 2] ? (vi ? "pha thêm " + sec[3] : "mixed with a touch of " + sec[4]) : "",
    mod: mod ? mod[L] : "",
    lng: lng ? (vi ? "hát bằng " + lng[1] : "sung in " + lng[2]) : "",
    inst: inst ? (vi ? "có " + inst[1] + " nổi bật" : "featuring " + inst[2]) : "",
    place: g.co ? (vi ? "đến từ " + (X.C[g.co] || g.co) : "from " + (THE[g.co] || g.co)) : "",
    fam: fromTerm && fam0 ? (vi ? "thuộc nhóm " + fam0[0] : "part of the " + fam0[1] + " family") : "",
  };

  const name = cap(g.n);
  const tx = g.b < B_LO ? 0 : g.b > B_HI ? 1 : -1, ac = g.e < E_LO ? 0 : g.e > E_HI ? 1 : -1;
  const feel = [tx >= 0 && TEXTURE[lang][tx], ac >= 0 && ACOUSTIC[lang][ac]].filter(Boolean);
  const tail = !feel.length ? "" : " " + (vi ? `Nghe ${feel.join(", ")}.` : `Expect ${feel.join(" and ")}.`);
  const limit = 188 - tail.length;
  const order = ["sec", "mod", "lng", "inst", "place", "fam"];
  const drop = ["fam", "inst", "lng", "sec", "mod"];   // removed in this order when too long
  const build = () => name + (vi ? " là " : " is ") + [headText, ...order.map((k) => parts[k]).filter(Boolean)].join(", ") + ".";
  let s = build();
  for (const k of drop) { if (s.length <= limit) break; parts[k] = ""; s = build(); }
  return s + tail;
}
