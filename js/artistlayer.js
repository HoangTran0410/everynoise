// Artist layer of the map: the ~33k "core" artists as small points around their genres (positions from
// scripts/build_artist_map.py → data/amap.json, most popular first). Loaded only when the layer is first turned on
// (or an artist page asks for neighbours); the map draws it (map.setArtistLayer), zoom-gated, popular names first.
import { model } from "./data.js";
import { loadArtists } from "./artists.js";

const Q = 36 ** 3 - 1;
let loading = null;

/** Resolves to the layer: { n, k: Int32Array (artist index in artists.js), e, b: Float32Array (normalised map axes),
 *  c: genre colour per point, g0: main genre, at: Map(artist index → point), near(j, n) }. */
export function loadArtistLayer(artists) {
  if (!loading) {
    loading = Promise.all([
      fetch("data/amap.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error("amap " + r.status)))),
      loadArtists(),
    ]).then(([d]) => {
      const o = d.o.split(",");
      const n = o.length;
      const k = new Int32Array(n), e = new Float32Array(n), b = new Float32Array(n), g0 = new Int32Array(n);
      const c = new Array(n), at = new Map();
      for (let j = 0; j < n; j++) {
        k[j] = parseInt(o[j], 36);
        e[j] = parseInt(d.p.substr(j * 6, 3), 36) / Q;
        b[j] = parseInt(d.p.substr(j * 6 + 3, 3), 36) / Q;
        const gs = artists.genresOf(k[j]);
        g0[j] = gs.length ? gs[0] : -1;
        c[j] = g0[j] >= 0 ? model.G[g0[j]].c : "#888";
        at.set(k[j], j);
      }
      /** The n points closest to point j (map distance), most popular first among equals. */
      const near = (j, cnt = 8, ok = () => true) => {
        const best = [];
        for (let i = 0; i < n; i++) {
          if (i === j || !ok(i)) continue;
          const de = e[i] - e[j], db = b[i] - b[j], dd = de * de + db * db;
          if (best.length < cnt) { best.push([i, dd]); best.sort((x, y) => x[1] - y[1]); }
          else if (dd < best[cnt - 1][1]) { best[cnt - 1] = [i, dd]; best.sort((x, y) => x[1] - y[1]); }
        }
        return best.map((x) => x[0]);
      };
      return { n, k, e, b, c, g0, at, near, name: (j) => artists.nameOf(k[j]), bad: (j) => artists.isBad(k[j]) };
    }).catch((err) => { console.warn(err); loading = null; return null; });
  }
  return loading;
}
