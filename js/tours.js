// Guided listening journeys: the player walks through a list of genres while the
// map flies along. Great for kids and first-time visitors.
import { model, nearest } from "./data.js";
import { shuffle } from "./util.js";

const LISTS = [
  {
    id: "world", emoji: "🌍", title: "Vòng quanh thế giới",
    desc: "Bay qua 25 nền âm nhạc từ Việt Nam tới Hawaii.", kid: true,
    genres: ["v-pop", "vietnamese bolero", "vietnamese traditional", "k-pop", "j-pop", "mandopop", "thai pop",
      "gamelan", "qawwali", "throat singing", "turkish pop", "greek folk", "klezmer", "polka", "celtic",
      "flamenco", "fado", "chanson", "highlife", "afrobeat", "amapiano", "soukous", "reggae", "calypso",
      "samba", "bossa nova", "tango", "cumbia", "mariachi", "hawaiian", "yodeling"],
  },
  {
    id: "kids", emoji: "🧸", title: "Nhạc cho bé",
    desc: "Bài hát thiếu nhi, ru ngủ và nhảy múa khắp thế giới.", kid: true,
    genres: ["children's music", "preschool children's music", "nursery", "kids dance party", "children's folk",
      "children's choir", "musica infantil", "cancoes infantis", "musique pour enfants", "cancion infantil mexicana",
      "british children's music", "australian children's music", "lullaby", "instrumental lullaby"],
  },
  {
    id: "instruments", emoji: "🎻", title: "Đoán nhạc cụ",
    desc: "Mỗi thể loại là một nhạc cụ: piano, đàn tranh, kèn túi…", kid: true,
    genres: ["classical piano", "cello", "violin", "harp", "harpsichord", "classical guitar", "accordion", "banjo",
      "ukulele", "sitar", "koto", "guzheng", "erhu", "pipa", "shamisen", "bagpipe", "didgeridoo", "marimba",
      "steelpan", "kora", "oud", "theremin"],
  },
  {
    id: "time", emoji: "⏳", title: "Cỗ máy thời gian",
    desc: "Từ nhạc trung cổ tới hyperpop, theo dòng lịch sử.", kid: true,
    genres: ["medieval", "renaissance", "baroque", "classical era", "early romantic era", "impressionism",
      "delta blues", "swing", "bebop", "rock-and-roll", "doo-wop", "motown", "funk", "disco", "punk", "new wave",
      "synthpop", "house", "grunge", "britpop", "techno", "dubstep", "edm", "hyperpop"],
  },
  {
    id: "organic-electric", emoji: "🌿", title: "Từ mộc đến điện tử",
    desc: "Đi một đường thẳng trên bản đồ: từ nhạc mộc sang nhạc máy.", kid: true,
    build: (pool) => {
      const big = pool.filter((g) => g.k >= 6).sort((a, b) => a.e - b.e);
      const out = [];
      const n = 16;
      for (let k = 0; k < n; k++) out.push(big[Math.floor((k / (n - 1)) * (big.length - 1))].i);
      return [...new Set(out)];
    },
  },
  {
    id: "drift", emoji: "🎲", title: "Trôi ngẫu nhiên",
    desc: "Bắt đầu ở một nơi bất kỳ rồi trôi sang hàng xóm gần nhất.", kid: true,
    build: (pool, ok) => {
      const start = pool[Math.floor(Math.random() * pool.length)].i;
      const seen = new Set([start]);
      const out = [start];
      let cur = start;
      for (let k = 0; k < 20; k++) {
        const nb = nearest(cur, 8, (h) => ok(h) && !seen.has(h.i));
        if (!nb.length) break;
        cur = nb[Math.floor(Math.random() * Math.min(3, nb.length))][0];
        seen.add(cur); out.push(cur);
      }
      return out;
    },
  },
];

export const TOURS = LISTS;

/** Resolve a tour into genre indices that exist and pass `ok` (e.g. kids mode). */
export function buildTour(t, ok) {
  const pool = model.G.filter((g) => ok(g));
  if (t.build) return t.build(pool, ok);
  return t.genres.map((n) => model.byName.get(n)).filter((i) => i != null && ok(model.G[i]));
}

export const shuffled = (arr) => shuffle(arr.slice());
