// Share links with a preview card. The app lives in the URL hash, which crawlers never see, so a shared
// link is /s?<the same keys as the hash>&t=<title>&d=<description>&c=<cover hash>: this page carries the
// Open Graph tags (Zalo, Messenger, iMessage, Telegram read them) and sends a browser straight on to /#<hash>.
const SITE = "https://everynoise.pages.dev";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function onRequestGet({ request }) {
  const u = new URL(request.url), p = u.searchParams;
  const title = (p.get("t") || "Everynoise").slice(0, 120);
  const desc = (p.get("d") || "Tap any music genre on Earth and hear it in a second. A playable map of 5,986 genres, free and no account.").slice(0, 300);
  const c = p.get("c");
  const img = /^[0-9a-f]{24}$/.test(c || "") ? `https://i.scdn.co/image/ab67616d0000b273${c}` : SITE + "/icons/og.jpg";
  for (const k of ["t", "d", "c"]) p.delete(k);
  const hash = p.toString();
  const target = SITE + "/" + (hash ? "#" + hash : "");
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta property="og:type" content="music.song">
<meta property="og:site_name" content="Everynoise">
<meta property="og:url" content="${esc(u.href)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="${c ? 640 : 1200}"><meta property="og:image:height" content="${c ? 640 : 630}">
<meta name="twitter:card" content="summary${c ? "" : "_large_image"}">
<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<link rel="canonical" href="${esc(target)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:600 16px system-ui,sans-serif;background:#0b0d14;color:#eef0f6}a{color:#9aa6ff}img{width:120px;height:120px;border-radius:18px;display:block;margin:0 auto 12px}</style>
</head><body><p><img src="${esc(img)}" alt="">${esc(title)}<br><a href="${esc(target)}">Mở trong Everynoise →</a></p>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=600" } });
}
