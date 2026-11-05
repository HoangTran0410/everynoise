// Backup / restore of everything the app keeps for the user (localStorage keys "nm:*": favourites, saved songs,
// listening history, routes, passport stamps, game records, settings) as one JSON file.
// Restore replaces the current data, then reloads so every module starts from the restored values.
import { $, el, toast } from "./util.js";
import { t, addStrings, fmtN, lang } from "./i18n.js";

const APP = "everynoise", V = 1;
const SKIP = new Set(["nm:covers", "nm:perfhud"]);   // caches / dev switches: rebuilt by themselves
const ours = (k) => k.startsWith("nm:") && !SKIP.has(k);

addStrings({
  "💾 Sao lưu dữ liệu": "💾 Backup",
  "Lưu yêu thích, bài hát, lịch sử, lộ trình, hộ chiếu và điểm game ra một file, rồi nhập lại trên máy khác.":
    "Save favourites, songs, history, routes, passport and game scores to one file, then import it on another device.",
  "⬇️ Xuất file": "⬇️ Export",
  "⬆️ Nhập file": "⬆️ Import",
  "Đã xuất {n} mục": "Exported {n} items",
  "File này không phải bản sao lưu của Everynoise": "This file is not an Everynoise backup",
  "Không đọc được file": "Could not read the file",
  "Bản sao lưu ngày {d}: {s}. Dữ liệu hiện tại trên máy này sẽ bị thay thế.":
    "Backup from {d}: {s}. The data on this device will be replaced.",
  "Khôi phục": "Restore",
  "Huỷ": "Cancel",
  "{n} yêu thích": "{n} favourites",
  "{n} bài hát": "{n} songs",
  "{n} thể loại đã nghe": "{n} genres heard",
  "{n} lộ trình": "{n} routes",
  "{n} con dấu": "{n} stamps",
  "cài đặt": "settings",
  "Đã khôi phục, đang tải lại…": "Restored, reloading…",
});

function snapshot() {
  const data = {};
  for (let k = 0; k < localStorage.length; k++) {
    const key = localStorage.key(k);
    if (!ours(key)) continue;
    const raw = localStorage.getItem(key);
    try { data[key] = JSON.parse(raw); } catch { data[key] = raw; }
  }
  return { app: APP, v: V, at: new Date().toISOString(), data };
}

const len = (x) => (Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : 0);
function summary(data) {
  const parts = [
    [len(data["nm:favs"]), "{n} yêu thích"], [len(data["nm:songs"]), "{n} bài hát"], [len(data["nm:visited"]), "{n} thể loại đã nghe"],
    [len(data["nm:routes"]), "{n} lộ trình"], [len(data["nm:stamps"]), "{n} con dấu"],
  ].filter(([n]) => n).map(([n, k]) => {
    const s = t(k, { n: fmtN(n) });
    return n === 1 && lang === "en" ? s.replace(/(\w)s\b/, "$1") : s;   // "1 songs" → "1 song", "1 genres heard" → "1 genre heard"
  });
  return (parts.length ? parts : [t("cài đặt")]).join(", ");
}

/** Parse a backup file's text; throws with a user-facing message when it is not one. */
export function parse(text) {
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(t("File này không phải bản sao lưu của Everynoise")); }
  if (!j || j.app !== APP || !j.data || typeof j.data !== "object") throw new Error(t("File này không phải bản sao lưu của Everynoise"));
  const data = {};
  for (const [k, v] of Object.entries(j.data)) if (ours(k)) data[k] = v;
  return { at: j.at, data };
}

export function restore(data) {
  for (const k of Object.keys(localStorage).filter(ours)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(data)) localStorage.setItem(k, JSON.stringify(v));
}

function download() {
  const snap = snapshot();
  const blob = new Blob([JSON.stringify(snap, null, 1)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `everynoise-backup-${snap.at.slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t("Đã xuất {n} mục", { n: fmtN(Object.keys(snap.data).length) }));
}

export function initBackup() {
  const file = $("#bk-file"), ask = $("#bk-ask");
  if (!file) return;
  let pending = null;
  $("#bk-export").onclick = download;
  $("#bk-import").onclick = () => { file.value = ""; file.click(); };
  file.onchange = async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      pending = parse(await f.text());
    } catch (e) { pending = null; ask.hidden = true; toast(e.message || t("Không đọc được file")); return; }
    const d = pending.at ? new Date(pending.at) : null;
    $("#bk-msg").textContent = t("Bản sao lưu ngày {d}: {s}. Dữ liệu hiện tại trên máy này sẽ bị thay thế.", {
      d: d && !isNaN(d) ? d.toLocaleDateString() : "?", s: summary(pending.data),
    });
    ask.hidden = false;
  };
  $("#bk-cancel").onclick = () => { pending = null; ask.hidden = true; };
  $("#bk-ok").onclick = () => {
    if (!pending) return;
    restore(pending.data);
    toast(t("Đã khôi phục, đang tải lại…"));
    setTimeout(() => location.reload(), 600);
  };
}
