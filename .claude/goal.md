# Share everything via the URL hash (always current)
- [ ] js/share.js: build hash from state (game > tour > genre+song, + filters), apply hash on load/hashchange, share helper
- [ ] main.js: replace setHash/readHash; sync on select/filters/track/tour/dialog; openGame registry; startList at step
- [ ] ab.js: sync on A/B change; share buttons (detail, tour bar, settings) use navigator.share on touch
- [ ] i18n keys; e2e test share.mjs (write + read for each kind); regression (i18n, C-games)
- [ ] commit, deploy, push, report
