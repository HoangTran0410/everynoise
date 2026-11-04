// "Radio theo giờ": a journey that fits the moment of the day, computed from the device clock only.
// Each moment scores every genre by how close it sits to a target on the map axes (e: organic 0 → electric 1,
// b: dense/atmospheric 0 → bouncy 1), family weights and a small popularity bonus; a pick seeded by the day makes
// the list change daily, and the list is ordered as a smooth ramp.
import { model } from "./data.js";
import { hash32 } from "./util.js";
import { t, addStrings } from "./i18n.js";

// e0/b0: target centre, se/sb: tolerance, fam: family weights (missing = 0)
const MOMENTS = [
  { id: "dawn", from: 5, to: 8, emoji: "🌅", name: "Radio sáng sớm", tags: "mộc, nhẹ, acoustic, folk, cổ điển",
    e0: 0.12, b0: 0.28, se: 0.14, sb: 0.2, dir: 1,
    fam: { "Folk & Traditional": 1, Classical: 1, "Wellness & Spoken": 0.6, Country: 0.5, "Indie & Alternative": 0.5, Jazz: 0.4 } },
  { id: "morning", from: 8, to: 11, emoji: "☀️", name: "Radio buổi sáng", tags: "tươi, pop, indie, jazz nhẹ",
    e0: 0.3, b0: 0.48, se: 0.16, sb: 0.2, dir: 1,
    fam: { Pop: 1, "Indie & Alternative": 1, Jazz: 0.8, "Folk & Traditional": 0.5, Country: 0.4, "R&B, Soul & Funk": 0.4, Latin: 0.4 } },
  { id: "noon", from: 11, to: 14, emoji: "🍜", name: "Radio buổi trưa", tags: "vừa phải, lounge, bossa, soul",
    e0: 0.3, b0: 0.45, se: 0.16, sb: 0.22, dir: 1,
    fam: { Jazz: 1, "R&B, Soul & Funk": 1, Latin: 0.9, "Reggae & Caribbean": 0.6, Pop: 0.5, "Folk & Traditional": 0.3 } },
  { id: "afternoon", from: 14, to: 18, emoji: "🌤️", name: "Radio buổi chiều", tags: "sôi nổi, rock, funk, hip hop",
    e0: 0.5, b0: 0.6, se: 0.18, sb: 0.2, dir: 1,
    fam: { Rock: 1, "R&B, Soul & Funk": 0.9, "Hip hop & Rap": 0.9, Electronic: 0.6, "Indie & Alternative": 0.7, Pop: 0.5, Latin: 0.4 } },
  { id: "evening", from: 18, to: 22, emoji: "🌆", name: "Radio buổi tối", tags: "điện tử, dance, latin",
    e0: 0.72, b0: 0.68, se: 0.2, sb: 0.2, dir: 1,
    fam: { Electronic: 1, Latin: 0.9, Pop: 0.7, "Hip hop & Rap": 0.6, "R&B, Soul & Funk": 0.6, "Reggae & Caribbean": 0.4 } },
  { id: "night", from: 22, to: 29, emoji: "🌙", name: "Radio đêm khuya", tags: "lo-fi, ambient, chill, ngủ",
    e0: 0.35, b0: 0.12, se: 0.2, sb: 0.1, dir: -1,
    fam: { "Wellness & Spoken": 1, Electronic: 0.7, Classical: 0.7, "Indie & Alternative": 0.4, Experimental: 0.4, Jazz: 0.4 } },
];
// weekend evening is a party: faster, more dance floor
const PARTY = { e0: 0.8, b0: 0.8, fam: { Electronic: 1, Latin: 1, "Hip hop & Rap": 0.8, Pop: 0.7, "Reggae & Caribbean": 0.6, "R&B, Soul & Funk": 0.5 }, tags: "tiệc cuối tuần, dance, latin, điện tử" };

addStrings({
  "Radio sáng sớm": "Sunrise radio", "Radio buổi sáng": "Morning radio", "Radio buổi trưa": "Midday radio",
  "Radio buổi chiều": "Afternoon radio", "Radio buổi tối": "Evening radio", "Radio đêm khuya": "Late-night radio",
  "mộc, nhẹ, acoustic, folk, cổ điển": "organic, gentle, acoustic, folk, classical",
  "tươi, pop, indie, jazz nhẹ": "fresh, pop, indie, light jazz",
  "vừa phải, lounge, bossa, soul": "easygoing, lounge, bossa, soul",
  "sôi nổi, rock, funk, hip hop": "lively, rock, funk, hip hop",
  "điện tử, dance, latin": "electronic, dance, latin",
  "tiệc cuối tuần, dance, latin, điện tử": "weekend party, dance, latin, electronic",
  "lo-fi, ambient, chill, ngủ": "lo-fi, ambient, chill, sleep",
  "Nhạc hợp với {hm} · {tags}": "Music for {hm} · {tags}",
});

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The moment (with weekend/party tweaks) for a Date. */
export function momentFor(date = new Date()) {
  let h = date.getHours();
  if (h < 5) h += 24;
  const m = MOMENTS.find((x) => h >= x.from && h < x.to) || MOMENTS[5];
  const weekend = [0, 6].includes(date.getDay());
  return weekend && m.id === "evening" ? { ...m, ...PARTY, weekend } : { ...m, weekend };
}

const rng = (seed) => () => {   // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};

const score = (g, m) => {
  const de = (g.e - m.e0) / m.se, db = (g.b - m.b0) / m.sb;
  let fw = 0;
  for (const f of g.f) fw = Math.max(fw, m.fam[f] || 0);
  return Math.exp(-(de * de + db * db) / 2) * Math.pow(0.1 + fw, 2) * (1 + 0.2 * Math.log1p(g.k));
};

/** ~20 genre indices that fit the moment of `date`; `ok` is the kids-mode gate. Always ≥ 8 (loosens the filter). */
export function listFor(date = new Date(), ok = () => true, n = 20) {
  const m = momentFor(date);
  const all = model.G.filter(ok);
  let pool = all.filter((g) => g.k >= 1);          // known enough to be worth hearing
  if (pool.length < 60) pool = all;
  const ranked = pool.map((g) => [g, score(g, m)]).sort((a, b) => b[1] - a[1]).slice(0, Math.max(60, n * 3));
  // weighted pick without replacement, seeded by day + moment so it changes daily
  const rand = rng(hash32(dayKey(date) + "|" + m.id));
  const bag = ranked.map(([g, s]) => [g, s * s]);
  const pick = [];
  while (pick.length < Math.min(n, bag.length)) {
    let sum = 0; for (const x of bag) sum += x[1];
    let r = rand() * sum, k = 0;
    while (k < bag.length - 1 && (r -= bag[k][1]) > 0) k++;
    pick.push(bag.splice(k, 1)[0][0]);
  }
  // smooth ramp: sort by energy, then break up runs of the same family inside small windows
  const en = (g) => (g.e + g.b) / 2;
  pick.sort((a, b) => (en(a) - en(b)) * m.dir);
  for (let i = 1; i < pick.length - 1; i++) {
    if (pick[i].f[0] !== pick[i - 1].f[0]) continue;
    for (let j = i + 1; j < Math.min(i + 3, pick.length); j++) {
      if (pick[j].f[0] !== pick[i - 1].f[0]) { [pick[i], pick[j]] = [pick[j], pick[i]]; break; }
    }
  }
  return pick.map((g) => g.i);
}

/** Tour object for tours.js: title/desc/emoji are getters so they follow the clock each time the grid is built. */
export const TIME_TOUR = {
  id: "time-radio", kid: true,
  get _m() { return momentFor(new Date()); },
  get emoji() { return this._m.emoji; },
  get title() { return t(this._m.name); },
  get desc() {
    const d = new Date();
    return t("Nhạc hợp với {hm} · {tags}", { hm: `${pad(d.getHours())}:${pad(d.getMinutes())}`, tags: t(this._m.tags) });
  },
  build: (pool, ok) => listFor(new Date(), ok),
};

window.__timeradio = { momentFor, listFor: (d, ok) => listFor(d, ok), moments: MOMENTS.map((m) => m.id) };
