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
    id: "viet-eras", emoji: "🇻🇳", title: "Nhạc Việt qua các thời kỳ",
    desc: "Từ nhạc dân tộc, bolero tới vinahouse và rap Việt.", kid: false,
    genres: ["vietnamese traditional", "vietnamese bolero", "vietnamese singer-songwriter", "vietnamese pop", "rock viet",
      "indie viet", "vietnamese idol pop", "vinahouse", "viet edm", "viet lo-fi", "viet instrumental",
      "vietnamese melodic rap", "vietnamese hip hop", "vietnamese trap", "viet chill rap"],
  },
  {
    id: "hiphop", emoji: "🎤", title: "Hip hop từ Bronx tới Sài Gòn",
    desc: "Từ old school, boom bap, trap, drill tới rap Việt.", kid: false,
    genres: ["old school hip hop", "east coast hip hop", "boom bap", "g funk", "southern hip hop", "conscious hip hop",
      "cloud rap", "trap", "uk drill", "french hip hop", "japanese old school hip hop", "korean old school hip hop",
      "german boom bap", "vietnamese hip hop", "vietnamese trap"],
  },
  {
    id: "screen", emoji: "🎬", title: "Nhạc phim và game",
    desc: "Phim Hollywood, anime, game 8-bit và synthwave.", kid: true,
    genres: ["soundtrack", "classic soundtrack", "orchestral soundtrack", "scorecore", "movie tunes", "anime",
      "classic anime", "anime score", "video game music", "chiptune", "indie game soundtrack", "lo-fi vgm",
      "korean soundtrack", "japanese soundtrack", "synthwave", "lo-fi beats"],
  },
  {
    id: "heavier", emoji: "🤘", title: "Nặng dần, nặng dần",
    desc: "Từ rock cổ điển tới thrash, death, black và doom.", kid: false,
    genres: ["classic rock", "hard rock", "speed metal", "power metal", "thrash metal", "melodic death metal",
      "death metal", "brutal death metal", "black metal", "atmospheric black metal", "doom metal", "funeral doom",
      "nu metal", "metalcore", "progressive metal", "symphonic black metal"],
  },
  {
    id: "beats", emoji: "🎛️", title: "Nhạc điện tử theo nhịp tim",
    desc: "Từ ambient chậm rãi tới house, techno, drum and bass.", kid: true,
    genres: ["ambient", "downtempo", "trip hop", "lo-fi beats", "chillwave", "synthwave", "house", "deep house",
      "acid house", "trance", "techno", "minimal techno", "breakbeat", "big beat", "jungle", "drum and bass",
      "dubstep", "uk garage", "hardstyle", "edm"],
  },
  {
    id: "jazz", emoji: "🎷", title: "Jazz qua các thập kỷ",
    desc: "Từ New Orleans, swing, bebop tới acid jazz và nu jazz.", kid: true,
    genres: ["new orleans jazz", "ragtime", "dixieland", "swing", "bebop", "cool jazz", "hard bop", "soul jazz",
      "free jazz", "jazz fusion", "smooth jazz", "acid jazz", "nu jazz", "vocal jazz", "latin jazz", "gypsy jazz",
      "contemporary jazz"],
  },
  {
    id: "latin", emoji: "💃", title: "Latin nhảy tưng bừng",
    desc: "Salsa, bachata, merengue, reggaeton, cumbia và samba.", kid: true,
    genres: ["salsa", "bachata", "merengue", "reggaeton", "cumbia", "bolero", "mambo", "cha-cha-cha", "son cubano",
      "latin pop", "vallenato", "samba", "forro", "axe", "bossa nova", "tango", "cumbia villera", "dembow",
      "tropical", "timba"],
  },
  {
    id: "sleep", emoji: "🌙", title: "Nhạc để thư giãn và ngủ",
    desc: "Ambient, ru ngủ, piano và thiền cho đêm yên tĩnh.", kid: true,
    genres: ["ambient", "sleep", "lullaby", "instrumental lullaby", "new age piano", "new age", "meditation",
      "guided meditation", "lo-fi sleep", "classical piano", "harp", "dronescape", "deep ambient", "drone ambient",
      "relaxative", "brain waves", "world meditation"],
  },
  {
    id: "africa", emoji: "🥁", title: "Âm thanh châu Phi",
    desc: "Từ highlife, afrobeat tới amapiano và soukous.", kid: true,
    genres: ["highlife", "juju", "afrobeat", "afropop", "amapiano", "gqom", "kwaito", "soukous", "rumba congolaise",
      "mbalax", "coupe-decale", "benga", "bongo flava", "gnawa", "rai", "ethio-jazz", "maskandi", "kora"],
  },
  {
    id: "orient", emoji: "🕌", title: "Từ Ấn Độ tới Trung Đông",
    desc: "Qawwali, Bollywood, nhạc Ả Rập, Ba Tư và Thổ Nhĩ Kỳ.", kid: true,
    genres: ["qawwali", "ghazal", "modern bollywood", "hindustani classical", "carnatic", "bhangra", "sitar", "filmi",
      "indian classical", "sufi", "arab pop", "khaleeji iraqi", "turkish pop", "turkish classical",
      "persian traditional", "oud", "dabke", "mizrahi", "klezmer"],
  },
  {
    id: "voices", emoji: "🎙️", title: "Những giọng hát đặc biệt",
    desc: "Opera, hát cổ họng, yodel, gospel, beatbox và a cappella.", kid: true,
    genres: ["opera", "throat singing", "yodeling", "gospel", "barbershop", "a cappella", "beatboxing", "choral",
      "gregorian chant", "doo-wop", "vocal jazz", "tuvan folk", "bulgarian folk", "mongolian folk", "qawwali",
      "vocal harmony group", "shanty", "sufi chant"],
  },
  {
    id: "festive", emoji: "🎉", title: "Lễ hội khắp nơi",
    desc: "Giáng sinh, Oktoberfest, carnival và những điệu hội làng.", kid: true,
    genres: ["christmas instrumental", "villancicos", "noel quebecois", "oktoberfest", "polka", "schlager", "mariachi",
      "ranchera", "banda", "calypso", "soca", "steelpan", "samba", "frevo", "axe", "forro", "pagode", "hawaiian",
      "cumbia", "bhangra", "dabke", "klezmer", "irish folk"],
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
