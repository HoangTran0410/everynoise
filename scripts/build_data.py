#!/usr/bin/env python3
"""Turn the raw Every Noise scrape (data/raw/genre_attrs.csv) into data/genres.json.

Inputs:
  data/raw/genre_attrs.csv  genre, x, y, hex_colour (map position and colour)
  data/raw/previews.json    genre -> 30s preview, Spotify track id, artist, song

Raw columns: genre, x, y, hex_colour
  x: 0..1500  (left = denser & more atmospheric, right = spikier & bouncier)
  y: ~0..19700 (bottom = more organic, top = more mechanical & electric)

Derived fields added here:
  - families   : coarse style families detected from keywords (Rock, Metal, ...)
  - country    : country detected from demonyms / country words in the name
  - scene      : auto-detected local scene place (e.g. "aarhus" in "aarhus indie")
  - parents    : other genres whose name is a whole-word part of this one
  - k          : number of genres that contain this one (used for label priority)
  - kid        : 1 if the genre passes the (heuristic) kids-mode filter
  - ap         : 1 if the position is estimated from the parent genre

data/tracks.json is aligned with genres: [preview id, spotify track id, artist, song] or null.
data/more/<k>.json (k = genre index // SHARD) holds the extra demo tracks: {"<genre index>": [track, ...]}
  built from data/raw/genre_artists.json (scripts/scrape_artists.py: the artists Every Noise lists on
  each genre page, biggest first) minus data/raw/dead_previews.txt.

Usage: python3 scripts/build_data.py
"""
import csv
import hashlib
import json
import math
import os
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "genre_attrs.csv"
PREVIEWS = ROOT / "data" / "raw" / "previews.json"
OUT = ROOT / "data" / "genres.json"
TRACKS = ROOT / "data" / "tracks.json"
ARTISTS_ALL = Path(os.environ.get("EN_ARTISTS_ALL") or ROOT / "data" / "raw" / "genre_artists_all.json.gz")  # (env EN_ARTISTS_ALL overrides) same shape, every artist (page sizes)
ARTISTS = ROOT / "data" / "raw" / "genre_artists.json"   # page slug -> [[size, preview id, track id, artist, song], ...]
DEAD = ROOT / "data" / "raw" / "dead_previews.txt"       # preview ids that no longer play
MORE = ROOT / "data" / "more"
SHARD = 80          # genres per data/more shard (keep in sync with js/data.js)
EXTRA = 5           # extra tracks per genre (6 with the first one)
EXTRA_KID = 5
SPREAD_W = 4
FAMILY_W = 24   # rank penalty when the artist's home genre is in another family (rap on a pop page)       # rank penalty per doubling of the genres an artist is listed in (see build_more)       # kid-flagged genres (~79% of all) get as many; KID_BAD still filters their songs/artists
# song/artist words that never belong in a kids-mode pick
KID_BAD = re.compile(r"\b(fuck\w*|shit\w*|bitch\w*|nigg\w*|sex\w*|porn\w*|whore|slut|cock|dick|pussy|ass|horny|drunk|cocaine|weed|"
                     r"kill\w*|murder|suicide|die|death|dead|blood|gun|bang|hell|devil|satan\w*|drug\w*|hoe|booty|strip\w*|naked|"
                     r"explicit|nsfw|putain|merde|puta|mierda|joder|cabron|pendejo|culo|porra|caralho|scheisse|schei\w+)\b|\*", re.I)

FAMILIES = {
    "Pop": ["pop", "idol", "schlager", "boy band", "girl group", "eurovision", "europop",
            "kayokyoku", "mandopop", "cantopop", "city pop", "bubblegum", "teen"],
    "Rock": ["rock", "punk", "grunge", "emo", "shoegaze", "garage", "rockabilly", "surf",
             "britpop", "post-punk", "psychedelic", "stoner", "screamo", "mod", "beat", "hardcore",
             "psychobilly", "jam band", "math rock", "post-hardcore", "'n' roll"],
    "Metal": ["metal", "metalcore", "deathcore", "grindcore", "doom", "thrash", "sludge",
              "djent", "black metal", "death metal", "nwobhm", "power metal", "crust", "goregrind"],
    "Hip hop & Rap": ["hip hop", "rap", "trap", "drill", "grime", "boom bap", "phonk",
                      "crunk", "hyphy", "bounce", "horrorcore", "g funk", "plugg"],
    "Electronic": ["house", "techno", "trance", "edm", "electro", "electronic", "electronica",
                   "dnb", "drum and bass", "dubstep", "idm", "ambient", "breakbeat", "breaks",
                   "hardstyle", "synth", "synthwave", "chillwave", "downtempo", "bass", "jungle",
                   "glitch", "chiptune", "8-bit", "vaporwave", "gabber", "hardcore techno",
                   "eurodance", "dance", "big beat", "trip hop", "footwork", "uk garage",
                   "future", "wave", "moombahton", "complextro", "brostep", "rave", "lo-fi beats",
                   "hi-nrg", "industrial", "ebm", "darkwave", "witch house", "tekno", "minimal",
                   "nightcore", "hyperpop", "electroclash", "synthpop", "psychill", "rawstyle",
                   "sovietwave", "plunderphonics", "chill", "nitzhonot", "hi-tech", "remix"],
    "Jazz": ["jazz", "swing", "bebop", "big band", "bossa nova", "hard bop", "dixieland",
             "ragtime", "stride", "vocal jazz"],
    "Classical": ["classical", "baroque", "orchestra", "orchestral", "opera", "choir", "choral",
                  "chamber", "symphony", "string quartet", "early music", "medieval",
                  "renaissance", "romantic", "minimalism", "impressionism", "neoclassical",
                  "harpsichord", "organ", "lieder", "requiem", "cello", "violin", "piano"],
    "Folk & Traditional": ["folk", "traditional", "folklore", "bluegrass", "celtic", "shanties",
                           "americana", "appalachian", "polka", "fado", "rebetiko", "klezmer",
                           "flamenco", "tango", "chanson", "volksmusik", "joik", "throat singing",
                           "balkan", "gnawa", "qawwali", "ghazal", "carnatic", "hindustani",
                           "singer-songwriter", "cajun", "fiddle", "old-time", "roots", "sufi", "trot"],
    "Country": ["country", "honky tonk", "outlaw", "red dirt", "western swing", "texas"],
    "R&B, Soul & Funk": ["r&b", "soul", "funk", "motown", "disco", "neo soul", "quiet storm",
                         "new jack swing", "doo-wop", "boogie", "go-go"],
    "Blues": ["blues", "delta blues", "jump blues"],
    "Latin": ["latin", "latino", "reggaeton", "cumbia", "salsa", "bachata", "merengue", "banda",
              "corrido", "corridos", "norteno", "mariachi", "sertanejo", "samba", "forro", "mpb",
              "musica", "ranchera", "urbano", "vallenato", "bolero", "son", "trova", "axe",
              "pagode", "funk carioca", "baile", "dembow", "grupera", "duranguense", "tropical",
              "brasileiro", "mexicano", "chileno", "argentino", "colombiano", "peruano"],
    "Reggae & Caribbean": ["reggae", "dancehall", "ska", "dub", "soca", "calypso", "zouk",
                           "kompa", "rocksteady", "lovers rock", "ragga", "steelpan", "kizomba"],
    "African": ["afrobeat", "afrobeats", "afropop", "afro", "highlife", "amapiano", "kwaito",
                "gqom", "bongo flava", "soukous", "mbalax", "juju", "fuji", "coupe-decale",
                "makossa", "benga", "gengetone", "azonto"],
    "Religious": ["christian", "worship", "gospel", "ccm", "hymn", "hymns", "adoracao",
                  "adoracion", "praise", "devotional", "bhajan", "nasheed", "kirtan", "chant"],
    "Soundtrack & Media": ["soundtrack", "video game", "anime", "disney", "broadway",
                           "show tunes", "musical", "children's", "kids", "lullaby", "comedy",
                           "cartoon", "vgm", "movie", "film", "tv", "theme", "cabaret",
                           "histoire pour enfants"],
    "Experimental": ["experimental", "noise", "avant-garde", "drone", "free improvisation",
                     "musique concrete", "acousmatic", "electroacoustic", "sound art",
                     "field recording", "free jazz", "harsh", "power electronics"],
    "Indie & Alternative": ["indie", "alternative", "lo-fi", "bedroom", "dream pop", "slowcore",
                            "art pop", "chamber pop", "twee", "jangle", "freak folk", "c86"],
    "Wellness & Spoken": ["meditation", "sleep", "asmr", "relaxation", "healing", "binaural",
                          "432hz", "528hz", "spoken word", "poetry", "audiobook", "reading",
                          "sound", "nature", "rain", "white noise", "yoga", "hz"],
}

# demonym / country words -> country name
COUNTRY_WORDS = {
    "afghan": "Afghanistan", "albanian": "Albania", "algerian": "Algeria", "american": "USA",
    "us": "USA", "usa": "USA", "angolan": "Angola", "argentine": "Argentina",
    "argentino": "Argentina", "armenian": "Armenia", "australian": "Australia", "aussie": "Australia",
    "austrian": "Austria", "azerbaijani": "Azerbaijan", "azeri": "Azerbaijan",
    "bahamian": "Bahamas", "bangladeshi": "Bangladesh", "bangla": "Bangladesh",
    "barbadian": "Barbados", "basque": "Spain", "belarusian": "Belarus", "belgian": "Belgium",
    "beninese": "Benin", "bhutanese": "Bhutan", "bolivian": "Bolivia", "bosnian": "Bosnia",
    "brazilian": "Brazil", "brasileiro": "Brazil", "brasileira": "Brazil", "british": "UK",
    "uk": "UK", "english": "UK", "scottish": "UK", "welsh": "UK", "cymraeg": "UK",
    "northern irish": "UK", "bulgarian": "Bulgaria", "burkinabe": "Burkina Faso",
    "burmese": "Myanmar", "cambodian": "Cambodia", "khmer": "Cambodia",
    "cameroonian": "Cameroon", "canadian": "Canada", "quebecois": "Canada",
    "cape verdean": "Cape Verde", "catala": "Spain", "catalan": "Spain", "chilean": "Chile",
    "chileno": "Chile", "chinese": "China", "c-pop": "China", "mandopop": "China",
    "cantopop": "Hong Kong", "hong kong": "Hong Kong", "colombian": "Colombia",
    "colombiano": "Colombia", "congolese": "DR Congo", "costa rican": "Costa Rica",
    "croatian": "Croatia", "cuban": "Cuba", "cubano": "Cuba", "cypriot": "Cyprus",
    "czech": "Czechia", "danish": "Denmark", "dansk": "Denmark", "dominican": "Dominican Republic",
    "dutch": "Netherlands", "nederlandse": "Netherlands", "ecuadorian": "Ecuador",
    "egyptian": "Egypt", "salvadoran": "El Salvador", "estonian": "Estonia",
    "ethiopian": "Ethiopia", "faroese": "Faroe Islands", "fijian": "Fiji", "filipino": "Philippines",
    "pinoy": "Philippines", "opm": "Philippines", "finnish": "Finland", "suomi": "Finland",
    "french": "France", "francais": "France", "chanson": "France", "gabonese": "Gabon",
    "gambian": "Gambia", "georgian": "Georgia", "german": "Germany", "deutsch": "Germany",
    "ghanaian": "Ghana", "greek": "Greece", "greenlandic": "Greenland",
    "guatemalan": "Guatemala", "guinean": "Guinea", "haitian": "Haiti", "honduran": "Honduras",
    "hungarian": "Hungary", "magyar": "Hungary", "icelandic": "Iceland", "indian": "India",
    "bollywood": "India", "tollywood": "India", "kollywood": "India", "indonesian": "Indonesia",
    "iranian": "Iran", "persian": "Iran", "iraqi": "Iraq", "irish": "Ireland",
    "israeli": "Israel", "italian": "Italy", "italiana": "Italy", "ivorian": "Ivory Coast",
    "jamaican": "Jamaica", "japanese": "Japan", "j-pop": "Japan", "j-rock": "Japan",
    "jordanian": "Jordan", "kazakh": "Kazakhstan", "kenyan": "Kenya", "korean": "South Korea",
    "k-pop": "South Korea", "k-indie": "South Korea", "kosovan": "Kosovo", "kurdish": "Kurdistan",
    "kuwaiti": "Kuwait", "kyrgyz": "Kyrgyzstan", "lao": "Laos", "latvian": "Latvia",
    "lebanese": "Lebanon", "liberian": "Liberia", "libyan": "Libya", "lithuanian": "Lithuania",
    "luxembourgian": "Luxembourg", "macedonian": "North Macedonia", "malagasy": "Madagascar",
    "malawian": "Malawi", "malaysian": "Malaysia", "malian": "Mali", "maltese": "Malta",
    "maori": "New Zealand", "mauritian": "Mauritius", "mexican": "Mexico", "mexicano": "Mexico",
    "moldovan": "Moldova", "mongolian": "Mongolia", "montenegrin": "Montenegro",
    "moroccan": "Morocco", "mozambican": "Mozambique", "namibian": "Namibia",
    "nepali": "Nepal", "nz": "New Zealand", "kiwi": "New Zealand", "nicaraguan": "Nicaragua",
    "nigerian": "Nigeria", "norwegian": "Norway", "norsk": "Norway", "omani": "Oman",
    "pakistani": "Pakistan", "palestinian": "Palestine", "panamanian": "Panama",
    "paraguayan": "Paraguay", "peruvian": "Peru", "peruano": "Peru", "polish": "Poland",
    "portuguese": "Portugal", "puerto rican": "Puerto Rico", "qatari": "Qatar",
    "romanian": "Romania", "russian": "Russia", "rwandan": "Rwanda", "samoan": "Samoa",
    "saudi": "Saudi Arabia", "senegalese": "Senegal", "serbian": "Serbia",
    "sierra leonean": "Sierra Leone", "singaporean": "Singapore", "slovak": "Slovakia",
    "slovenian": "Slovenia", "somali": "Somalia", "south african": "South Africa",
    "spanish": "Spain", "espanol": "Spain", "sri lankan": "Sri Lanka", "sudanese": "Sudan",
    "surinamese": "Suriname", "swedish": "Sweden", "svensk": "Sweden", "swiss": "Switzerland",
    "syrian": "Syria", "taiwan": "Taiwan", "taiwanese": "Taiwan", "tajik": "Tajikistan",
    "tanzanian": "Tanzania", "thai": "Thailand", "tibetan": "Tibet", "togolese": "Togo",
    "trinidadian": "Trinidad & Tobago", "tunisian": "Tunisia", "turkish": "Turkey",
    "turkmen": "Turkmenistan", "ugandan": "Uganda", "ukrainian": "Ukraine", "emirati": "UAE",
    "uruguayan": "Uruguay", "uzbek": "Uzbekistan", "venezuelan": "Venezuela",
    "vietnamese": "Vietnam", "viet": "Vietnam", "v-pop": "Vietnam", "yemeni": "Yemen", "zambian": "Zambia",
    "zimbabwean": "Zimbabwe", "arab": "Arab world", "arabic": "Arab world",
    "khaleeji": "Arab world", "african": "Africa", "latin": "Latin America",
    "nordic": "Nordics", "scandinavian": "Nordics", "balkan": "Balkans",
    "texas": "USA", "chicago": "USA", "detroit": "USA", "atlanta": "USA", "houston": "USA",
    "memphis": "USA", "nyc": "USA", "brooklyn": "USA", "la": "USA", "louisiana": "USA",
    "southern": "USA", "dirty south": "USA", "bay area": "USA", "new orleans": "USA",
    "seattle": "USA", "philly": "USA", "boston": "USA", "minneapolis": "USA",
    "baltimore": "USA", "miami": "USA", "nashville": "USA", "london": "UK",
    "manchester": "UK", "liverpool": "UK", "bristol": "UK", "glasgow": "UK",
    "toronto": "Canada", "montreal": "Canada", "vancouver": "Canada",
    "melbourne": "Australia", "sydney": "Australia", "perth": "Australia",
    "brisbane": "Australia", "adelaide": "Australia", "tokyo": "Japan", "osaka": "Japan",
    "berlin": "Germany", "hamburg": "Germany", "paris": "France", "stockholm": "Sweden",
    "gothenburg": "Sweden", "goteborg": "Sweden", "oslo": "Norway", "bergen": "Norway",
    "copenhagen": "Denmark", "aarhus": "Denmark", "helsinki": "Finland", "dublin": "Ireland",
    "amsterdam": "Netherlands", "rotterdam": "Netherlands", "brussels": "Belgium",
    "vienna": "Austria", "zurich": "Switzerland", "milan": "Italy", "rome": "Italy",
    "napoli": "Italy", "madrid": "Spain", "barcelona": "Spain", "lisbon": "Portugal",
    "sao paulo": "Brazil", "rio": "Brazil", "bogota": "Colombia", "medellin": "Colombia",
    "lima": "Peru", "santiago": "Chile", "buenos aires": "Argentina", "mumbai": "India",
    "seoul": "South Korea", "taipei": "Taiwan", "manila": "Philippines",
    "jakarta": "Indonesia", "bandung": "Indonesia", "bangkok": "Thailand",
    "lagos": "Nigeria", "accra": "Ghana", "nairobi": "Kenya", "cape town": "South Africa",
    "auckland": "New Zealand", "wellington": "New Zealand", "dalarna": "Sweden",
    "skane": "Sweden", "uppsala": "Sweden", "malmo": "Sweden", "aberdeen": "UK",
    "leeds": "UK", "sheffield": "UK", "birmingham": "UK", "edinburgh": "UK", "cardiff": "UK",
    "belfast": "UK", "cork": "Ireland", "galway": "Ireland", "ottawa": "Canada",
    "calgary": "Canada", "halifax": "Canada", "winnipeg": "Canada", "edmonton": "Canada",
    "hobart": "Australia", "canberra": "Australia", "munich": "Germany", "cologne": "Germany",
    "leipzig": "Germany", "dresden": "Germany", "stuttgart": "Germany", "frankfurt": "Germany",
    "lyon": "France", "marseille": "France", "bordeaux": "France", "nantes": "France",
    "torino": "Italy", "bologna": "Italy", "firenze": "Italy", "sevilla": "Spain",
    "valencia": "Spain", "bilbao": "Spain", "porto": "Portugal", "krakow": "Poland",
    "warsaw": "Poland", "prague": "Czechia", "budapest": "Hungary", "athens": "Greece",
    "istanbul": "Turkey", "kyiv": "Ukraine", "moscow": "Russia", "st petersburg": "Russia",
}

# words that are styles / qualifiers, never places
STYLE_WORDS = set()
for kws in FAMILIES.values():
    for kw in kws:
        STYLE_WORDS.update(kw.split())
STYLE_WORDS.update("""deep dark new old modern classic vintage early contemporary underground
alternative experimental traditional instrumental progressive melodic hard heavy soft acoustic
dance music scene band bands singer-songwriter vocal power post neo nu proto avant
underground chill cool black death old-school oldschool christian of the and a la de
el los las le du di da do y e i n'""".split())

SCENE_SUFFIX = re.compile(
    r"^(?P<place>.+?) (indie|indie rock|indie pop|scene|underground|hip hop|rap|punk|hardcore|metal|rock|pop)$"
)


def ngrams(name: str) -> set:
    """All contiguous word sub-phrases of a name (splitting on spaces and hyphens too)."""
    out = set()
    for toks in (name.split(), re.split(r"[\s\-]+", name)):
        for i in range(len(toks)):
            for j in range(i + 1, len(toks) + 1):
                out.add(" ".join(toks[i:j]))
    return out


def contains_phrase(name: str, phrase: str) -> bool:
    return phrase in ngrams(name)


# Kids mode is a best-effort filter: the data has no "explicit" flag, so we drop families
# and words that usually mean adult themes or harsh sounds.
KID_BLOCK_FAMILIES = {"Hip hop & Rap", "Metal"}
KID_BLOCK_WORDS = set("""
horror horrorcore gore goregrind grind grindcore death deathcore black satanic occult
gangster gangsta drill trap porn sex sexy erotic drug drugs stoner weed cannabis crunk
thug murder kill war harsh noise power electronics brutal slam sludge doom hardcore
deathrock dark darkwave witch depressive suicidal nsbm hate fight battle diss
drinking bar strip twerk booty explicit cursed creepy haunted erotica erotic sexual
fetish bdsm nsfw vulgar dirty gangsta rap pimp hustle
""".split())


def place_extra(name, coord_by_name, grams):
    """Genres that only exist in the preview list get the position of their most
    specific parent genre, plus a small deterministic offset."""
    cands = [p for p in grams if p != name and p in coord_by_name]
    if not cands:
        return None
    parent = max(cands, key=lambda p: (len(p.split()), len(p)))
    px, py = coord_by_name[parent]
    h = int(hashlib.md5(name.encode()).hexdigest(), 16)
    dx = (h % 1000) / 1000 * 50 - 25
    dy = ((h // 1000) % 1000) / 1000 * 260 - 130
    return int(min(1500, max(0, px + dx))), int(min(19700, max(0, py + dy))), parent


def page_slug(name: str) -> str:
    """everynoise.com/engenremap-<slug>.html: the lower-cased name without anything but a-z and 0-9."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def make_ranker(pages, out):
    """Returns rank(o, cands) -> cands in play order for genre o (shared by data/more and data/radio).
    pages: page slug -> rows, the set the artist statistics (spread, home genre) are taken from."""
    # Spotify tags genres per ARTIST and Every Noise orders a page by popularity, so the top of e.g.
    # "v-pop" is the biggest Vietnamese rappers (also tagged v-pop). Prefer artists *specific* to the
    # genre: score = page rank + SPREAD_W * log2(pages listing the artist); lowest first.
    spread = Counter(a[3].lower() for rows in pages.values() for a in rows)
    # An artist's *home* genre: the page where they rank highest (absolute rank); ties go to the
    # smaller (more specific) page. tlinh tops both "v-pop" (358 artists) and "vietnamese hip hop" (smaller)
    # -> home is hip hop, a different family than v-pop, so v-pop prefers its own (pop) artists.
    import gzip
    total = {}
    if ARTISTS_ALL.exists():
        with gzip.open(ARTISTS_ALL, "rt", encoding="utf-8") as f:
            total = {k: len(v) for k, v in json.load(f).items()}
    fam_of = {page_slug(o["n"]): set(o["f"] or []) for o in out}
    home = {}
    for slug, rows in pages.items():
        n = total.get(slug, len(rows))
        for r, a in enumerate(sorted(rows, key=lambda c: -c[0])):
            key, cur = a[3].lower(), (r, n)
            if key not in home or cur < home[key][0]:
                home[key] = (cur, slug)

    def foreign(artist, fams):
        h = home.get(artist.lower())
        hf = fam_of.get(h[1], set()) if h else set()
        return bool(fams and hf and not (fams & hf))

    def rank(o, cands):
        fams = set(o["f"] or [])
        ranked = sorted(cands, key=lambda c: -c[0])   # page order: biggest font first
        ranked = sorted(enumerate(ranked), key=lambda rc: rc[0] + SPREAD_W * math.log2(spread[rc[1][3].lower()])
                        + FAMILY_W * foreign(rc[1][3], fams))
        return [c for _, c in ranked]
    return rank


def build_more(out, tracks):
    """Pick the extra demo tracks of every genre and write them as shards. Deterministic."""
    if not ARTISTS.exists():
        print("no", ARTISTS.name, "- skipping data/more")
        return
    pages = json.loads(ARTISTS.read_text(encoding="utf-8"))
    dead = set(DEAD.read_text().split()) if DEAD.exists() else set()
    shards, counts = {}, Counter()
    rank = make_ranker(pages, out)
    for i, o in enumerate(out):
        first = tracks[i]
        cands = pages.get(page_slug(o["n"]))
        if not first or not cands:
            continue
        kid = bool(o["kid"])
        used = {first[2].lower()}
        picks = []
        for size, pid, tid, artist, song in rank(o, cands):
            if pid in dead or pid == first[0] or artist.lower() in used:
                continue
            if kid and (KID_BAD.search(song) or KID_BAD.search(artist)):
                continue
            used.add(artist.lower())
            picks.append([pid, tid, artist, song])
            if len(picks) >= (EXTRA_KID if kid else EXTRA):
                break
        counts[len(picks) + 1] += 1
        if picks:
            shards.setdefault(i // SHARD, {})[str(i)] = picks
    MORE.mkdir(exist_ok=True)
    for f in MORE.glob("*.json"):
        f.unlink()
    for k, d in shards.items():
        (MORE / f"{k}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sizes = [f.stat().st_size for f in MORE.glob("*.json")]
    print("more: shards", len(sizes), "total KB", sum(sizes) // 1024, "max KB", max(sizes) // 1024,
          "tracks per genre:", sorted(counts.items()))


def main():
    rows = list(csv.DictReader(RAW.open(encoding="utf-8")))
    previews = json.loads(PREVIEWS.read_text(encoding="utf-8"))
    pv_by_name = {p["g"].strip(): p for p in previews}

    coord_by_name = {r["genre"].strip(): (int(r["x"]), int(r["y"])) for r in rows}
    entries = [{"n": r["genre"].strip(), "x": int(r["x"]), "y": int(r["y"]),
                "c": r["hex_colour"].strip(), "ap": 0} for r in rows]
    skipped = []
    for n, p in pv_by_name.items():
        if n in coord_by_name:
            continue
        pos = place_extra(n, coord_by_name, ngrams(n))
        if pos is None:
            skipped.append(n)
            continue
        entries.append({"n": n, "x": pos[0], "y": pos[1], "c": p["c"], "ap": 1})

    names = [e["n"] for e in entries]
    name_set = set(names)
    token_freq = Counter(t for n in names for t in n.split())

    # parents: shorter genre names fully contained (whole-word) in this one
    kids = Counter()
    parents_of = {}
    grams = {n: ngrams(n) for n in names}
    for n in names:
        ps = [p for p in grams[n] if p != n and p in name_set]
        # keep only the most specific parents (drop "rock" if "indie rock" is present)
        ps = sorted(p for p in ps if not any(q != p and p in grams.get(q, ()) for q in ps))
        parents_of[n] = ps
        for p in ps:
            kids[p] += 1

    out, tracks = [], []
    for e in entries:
        n = e["n"]
        g = grams[n]
        fams = [f for f, kws in FAMILIES.items() if any(k in g for k in kws)]
        # "vietnamese bolero" is nhạc vàng, not Latin: a Vietnamese genre keeps only the non-Latin families
        if "Latin" in fams and ("vietnamese" in g or "viet" in g):
            fams = [f for f in fams if f != "Latin"] or ["Folk & Traditional"]
        country = None
        hits = sorted((w for w in g if w in COUNTRY_WORDS), key=len, reverse=True)
        if hits:
            country = COUNTRY_WORDS[hits[0]]
        scene = None
        m = SCENE_SUFFIX.match(n)
        if m:
            place = m.group("place")
            toks = place.split()
            if all(t not in STYLE_WORDS and token_freq[t] <= 6 for t in toks):
                scene = place
        kid = int(not (set(fams) & KID_BLOCK_FAMILIES) and not (g & KID_BLOCK_WORDS))
        o = {"n": n, "x": e["x"], "y": e["y"], "c": e["c"], "f": fams, "co": country,
             "s": scene, "p": parents_of[n], "k": kids[n], "kid": kid}
        if e["ap"]:
            o["ap"] = 1
        pv = pv_by_name.get(n)
        if pv and pv["p"]:
            tracks.append([pv["p"].rsplit("/", 1)[-1], pv["t"], pv["a"], pv["s"]])
        else:
            tracks.append(None)
        out.append(o)

    meta = {
        "source": "https://everynoise.com",
        "coords": "github.com/AyrtonB/EveryNoise-Watch (CC-BY-SA-4.0)",
        "previews": "github.com/jtbartee/everynoise-jukebox",
        "count": len(out),
        "families": list(FAMILIES.keys()),
    }
    OUT.write_text(json.dumps({"meta": meta, "genres": out}, ensure_ascii=False,
                              separators=(",", ":")), encoding="utf-8")
    TRACKS.write_text(json.dumps(tracks, ensure_ascii=False, separators=(",", ":")),
                      encoding="utf-8")

    build_more(out, tracks)

    fam_counts = Counter(f for o in out for f in o["f"])
    print("genres:", len(out), "(approx placed:", sum(1 for o in out if o.get("ap")),
          ", skipped:", len(skipped), ")")
    print("with preview:", sum(1 for t in tracks if t), "kid-safe:", sum(o["kid"] for o in out))
    print("no family:", sum(1 for o in out if not o["f"]))
    print("families:", fam_counts.most_common())
    print("with country:", sum(1 for o in out if o["co"]),
          "with scene:", sum(1 for o in out if o["s"]))
    print("size KB:", OUT.stat().st_size // 1024, "tracks KB:", TRACKS.stat().st_size // 1024)


if __name__ == "__main__":
    main()
