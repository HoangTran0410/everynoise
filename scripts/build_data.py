#!/usr/bin/env python3
"""Turn the raw Every Noise scrape (data/raw/genre_attrs.csv) into data/genres.json.

Raw columns: genre, x, y, hex_colour
  x: 0..1500  (left = denser & more atmospheric, right = spikier & bouncier)
  y: ~0..19700 (bottom = more organic, top = more mechanical & electric)

Derived fields added here:
  - families   : coarse style families detected from keywords (Rock, Metal, ...)
  - country    : country detected from demonyms / country words in the name
  - scene      : auto-detected local scene place (e.g. "aarhus" in "aarhus indie")
  - parents    : other genres whose name is a whole-word part of this one
  - kids       : number of genres that contain this one (used for label priority)

Usage: python3 scripts/build_data.py
"""
import csv
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "genre_attrs.csv"
OUT = ROOT / "data" / "genres.json"

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


def main():
    rows = list(csv.DictReader(RAW.open(encoding="utf-8")))
    names = [r["genre"].strip() for r in rows]
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

    out = []
    for r in rows:
        n = r["genre"].strip()
        g = grams[n]
        fams = [f for f, kws in FAMILIES.items() if any(k in g for k in kws)]
        country = None
        hits = sorted((w for w in g if w in COUNTRY_WORDS), key=len, reverse=True)
        if hits:
            country = COUNTRY_WORDS[hits[0]]
        scene = None
        m = SCENE_SUFFIX.match(n)
        if m:
            place = m.group("place")
            toks = place.split()
            if all(t not in STYLE_WORDS and token_freq[t] <= 6 for t in toks) and not \
                    any(t in COUNTRY_WORDS and COUNTRY_WORDS[t] in ("Latin America",) for t in toks):
                if place not in COUNTRY_WORDS or COUNTRY_WORDS.get(place) not in (None,):
                    scene = place
        out.append({
            "n": n,
            "x": int(r["x"]),
            "y": int(r["y"]),
            "c": r["hex_colour"].strip(),
            "f": fams,
            "co": country,
            "s": scene,
            "p": parents_of[n],
        })

    for o in out:
        o["k"] = kids[o["n"]]

    meta = {
        "source": "https://everynoise.com (scraped by github.com/AyrtonB/EveryNoise-Watch)",
        "license": "CC-BY-SA-4.0",
        "count": len(out),
        "families": list(FAMILIES.keys()),
    }
    OUT.write_text(json.dumps({"meta": meta, "genres": out}, ensure_ascii=False,
                              separators=(",", ":")), encoding="utf-8")

    fam_counts = Counter(f for o in out for f in o["f"])
    print("genres:", len(out))
    print("no family:", sum(1 for o in out if not o["f"]))
    print("families:", fam_counts.most_common())
    print("with country:", sum(1 for o in out if o["co"]),
          "with scene:", sum(1 for o in out if o["s"]))
    print("top countries:", Counter(o["co"] for o in out if o["co"]).most_common(25))
    print("sample scenes:", [o["n"] for o in out if o["s"]][:40])
    print("top parents:", kids.most_common(20))
    print("size KB:", OUT.stat().st_size // 1024)


if __name__ == "__main__":
    main()
