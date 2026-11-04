#!/usr/bin/env python3
"""One-time build of data/world.json (SVG country shapes for the world-music map).
Source: world-atlas@2.0.2 countries-110m.json (Natural Earth, public domain).
  curl -L https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json -o /tmp/countries-110m.json
  python3 scripts/build_world.py /tmp/countries-110m.json data/world.json
Names are renamed to the `co` spelling used in data/genres.json; `iso` feeds Intl.DisplayNames. Stdlib only."""
import json, math, sys

ALIAS = {"United States of America": "USA", "United Kingdom": "UK", "Bosnia and Herz.": "Bosnia",
         "Dem. Rep. Congo": "DR Congo", "Dominican Rep.": "Dominican Republic", "Macedonia": "North Macedonia",
         "Trinidad and Tobago": "Trinidad & Tobago"}
ISO = {  # atlas name -> ISO 3166-1 alpha-2
 "Afghanistan": "AF", "Albania": "AL", "Algeria": "DZ", "Angola": "AO", "Azerbaijan": "AZ", "Argentina": "AR", "Australia": "AU",
 "Austria": "AT", "Bahamas": "BS", "Bangladesh": "BD", "Armenia": "AM", "Belgium": "BE", "Bhutan": "BT", "Bolivia": "BO",
 "Bosnia and Herz.": "BA", "Botswana": "BW", "Brazil": "BR", "Belize": "BZ", "Solomon Is.": "SB", "Brunei": "BN", "Bulgaria": "BG",
 "Myanmar": "MM", "Burundi": "BI", "Belarus": "BY", "Cambodia": "KH", "Cameroon": "CM", "Canada": "CA", "Central African Rep.": "CF",
 "Sri Lanka": "LK", "Chad": "TD", "Chile": "CL", "China": "CN", "Taiwan": "TW", "Colombia": "CO", "Congo": "CG", "Dem. Rep. Congo": "CD",
 "Costa Rica": "CR", "Croatia": "HR", "Cuba": "CU", "Cyprus": "CY", "Czechia": "CZ", "Benin": "BJ", "Denmark": "DK",
 "Dominican Rep.": "DO", "Ecuador": "EC", "El Salvador": "SV", "Eq. Guinea": "GQ", "Ethiopia": "ET", "Eritrea": "ER", "Estonia": "EE",
 "Falkland Is.": "FK", "Fiji": "FJ", "Finland": "FI", "France": "FR", "Djibouti": "DJ", "Gabon": "GA", "Georgia": "GE", "Gambia": "GM",
 "Palestine": "PS", "Germany": "DE", "Ghana": "GH", "Greece": "GR", "Greenland": "GL", "Guatemala": "GT", "Guinea": "GN", "Guyana": "GY",
 "Haiti": "HT", "Honduras": "HN", "Hungary": "HU", "Iceland": "IS", "India": "IN", "Indonesia": "ID", "Iran": "IR", "Iraq": "IQ",
 "Ireland": "IE", "Israel": "IL", "Italy": "IT", "Côte d'Ivoire": "CI", "Jamaica": "JM", "Japan": "JP", "Kazakhstan": "KZ", "Jordan": "JO",
 "Kenya": "KE", "North Korea": "KP", "South Korea": "KR", "Kuwait": "KW", "Kyrgyzstan": "KG", "Laos": "LA", "Lebanon": "LB",
 "Lesotho": "LS", "Latvia": "LV", "Liberia": "LR", "Libya": "LY", "Lithuania": "LT", "Luxembourg": "LU", "Madagascar": "MG",
 "Malawi": "MW", "Malaysia": "MY", "Mali": "ML", "Mauritania": "MR", "Mexico": "MX", "Mongolia": "MN", "Moldova": "MD",
 "Montenegro": "ME", "Morocco": "MA", "Mozambique": "MZ", "Oman": "OM", "Namibia": "NA", "Nepal": "NP", "Netherlands": "NL",
 "New Caledonia": "NC", "Vanuatu": "VU", "New Zealand": "NZ", "Nicaragua": "NI", "Niger": "NE", "Nigeria": "NG", "Norway": "NO",
 "Pakistan": "PK", "Panama": "PA", "Papua New Guinea": "PG", "Paraguay": "PY", "Peru": "PE", "Philippines": "PH", "Poland": "PL",
 "Portugal": "PT", "Guinea-Bissau": "GW", "Timor-Leste": "TL", "Puerto Rico": "PR", "Qatar": "QA", "Romania": "RO", "Russia": "RU",
 "Rwanda": "RW", "Saudi Arabia": "SA", "Senegal": "SN", "Serbia": "RS", "Sierra Leone": "SL", "Slovakia": "SK", "Vietnam": "VN",
 "Slovenia": "SI", "Somalia": "SO", "South Africa": "ZA", "Zimbabwe": "ZW", "Spain": "ES", "S. Sudan": "SS", "Sudan": "SD",
 "W. Sahara": "EH", "Suriname": "SR", "eSwatini": "SZ", "Sweden": "SE", "Switzerland": "CH", "Syria": "SY", "Tajikistan": "TJ",
 "Thailand": "TH", "Togo": "TG", "Trinidad and Tobago": "TT", "United Arab Emirates": "AE", "Tunisia": "TN", "Turkey": "TR",
 "Turkmenistan": "TM", "Uganda": "UG", "Ukraine": "UA", "Macedonia": "MK", "Egypt": "EG", "United Kingdom": "GB", "Tanzania": "TZ",
 "United States of America": "US", "Burkina Faso": "BF", "Uruguay": "UY", "Uzbekistan": "UZ", "Venezuela": "VE", "Yemen": "YE",
 "Zambia": "ZM", "Kosovo": "XK", "N. Cyprus": "", "Somaliland": "",
}
SKIP = {"Antarctica", "Fr. S. Antarctic Lands"}
# countries too small for a 110m shape: (lat, lon, ISO) -> drawn as dots
DOTS = {"Singapore": (1.35, 103.82, "SG"), "Malta": (35.9, 14.45, "MT"), "Barbados": (13.17, -59.55, "BB"),
        "Cape Verde": (16.0, -24.0, "CV"), "Faroe Islands": (62.0, -6.9, "FO"), "Hong Kong": (22.3, 114.17, "HK"),
        "Samoa": (-13.76, -172.1, "WS")}
W = 1000.0

def ne(lon, lat):  # Natural Earth I projection
    l, p = math.radians(lon), math.radians(lat); p2 = p * p; p4 = p2 * p2
    x = l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)))
    y = p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)))
    return x, -y

topo = json.load(open(sys.argv[1]))
sx, sy = topo["transform"]["scale"]; tx, ty = topo["transform"]["translate"]
arcs = []
for a in topo["arcs"]:
    x = y = 0; pts = []
    for dx, dy in a:
        x += dx; y += dy; pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)
def ring(idx):
    pts = []
    for i in idx:
        seg = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(seg if not pts else seg[1:])
    return pts
x0, x1 = ne(-180, 0)[0], ne(180, 0)[0]
k = W / (x1 - x0)
P = lambda lon, lat: ((ne(lon, lat)[0] - x0) * k, (ne(lon, lat)[1] + 0) * k)
top = P(0, 84)[1]; bot = P(0, -57)[1]
def ringpath(pts):
    q = []
    for p in pts:  # drop points closer than 0.35 units to the previous one
        if not q or abs(p[0] - q[-1][0]) + abs(p[1] - q[-1][1]) >= 0.35: q.append(p)
    if len(q) < 3: return ""
    area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(q, q[1:] + q[:1]))) / 2
    if area < 0.4: return ""
    px, py = round(q[0][0], 1), round(q[0][1], 1); d = f"M{px} {py}"
    for p in q[1:]:
        nx, ny = round(p[0], 1), round(p[1], 1)
        d += f"l{round(nx - px, 1):g} {round(ny - py, 1):g}"; px, py = nx, ny
    return d + "z"
shapes = []
for g in topo["objects"]["countries"]["geometries"]:
    name = g["properties"]["name"]
    if name in SKIP: continue
    polys = [g["arcs"]] if g["type"] == "Polygon" else g["arcs"]
    d = ""
    for poly in polys:
        for r in poly:
            ll = ring(r); un = [list(ll[0])]
            for lo, la in ll[1:]:  # unwrap longitudes so rings crossing +-180 stay continuous
                while lo - un[-1][0] > 180: lo -= 360
                while lo - un[-1][0] < -180: lo += 360
                un.append([lo, la])
            shifts = [0] + ([-360] if max(u[0] for u in un) > 180 else []) + ([360] if min(u[0] for u in un) < -180 else [])
            for sh in shifts:
              pts = [P(lo + sh, la) for lo, la in un]
              d += ringpath(pts)
    if d: shapes.append({"name": ALIAS.get(name, name), "iso": ISO[name], "d": d})
dots = [{"name": n, "iso": i, "x": round(P(lo, la)[0], 1), "y": round(P(lo, la)[1], 1)} for n, (la, lo, i) in DOTS.items()]
out = {"viewBox": f"0 {round(top, 1):g} {W:g} {round(bot - top, 1):g}", "countries": shapes, "dots": dots}
json.dump(out, open(sys.argv[2], "w"), ensure_ascii=False, separators=(",", ":"))
print(len(shapes), "shapes", len(json.dumps(out, ensure_ascii=False)), "bytes")
