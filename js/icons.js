// UI icons as inline SVG, drawn like the rest of the app's icons (24×24, stroke = currentColor, see `svg` in style.css).
// Emoji stay for content (journey and family badges, toasts, game text); controls and small list markers use these so
// a row never mixes an emoji with a line icon.
const P = {
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />',
  play: '<path class="fill" d="M8 5.5v13l10.5-6.5z" />',
  pause: '<path d="M9 5.5v13M15 5.5v13" />',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" />',
  speaker: '<path class="fill" d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />',
  close: '<path d="M6 6l12 12M18 6 6 18" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  minus: '<path d="M5 12h14" />',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />',
  up: '<path d="M12 19V5M6 11l6-6 6 6" />',
  down: '<path d="M12 5v14M6 13l6 6 6-6" />',
  record: '<circle class="fill" cx="12" cy="12" r="5.5" />',
  film: '<rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7.5 5v14M16.5 5v14M3.5 9.7h4M3.5 14.3h4M16.5 9.7h4M16.5 14.3h4" />',
  repeat: '<path d="m17 2 3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="m7 22-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" />',
  stop: '<rect class="fill" x="6.5" y="6.5" width="11" height="11" rx="2" />',
};
/** SVG markup for an icon (for innerHTML / templates). */
export const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="ic ic-${name}">${P[name] || ""}</svg>`;
/** The icon as a DOM node (for el() children / replaceChildren). */
export function ico(name) {
  const t = document.createElement("template");
  t.innerHTML = svg(name);
  return t.content.firstChild;
}
