'use strict';
// Session Observer dashboard — start-up: wires every feature's controls, loads the data and starts the render loop.
const AGO_REFRESH_MS = 15000;
const RESIZE_SETTLE_MS = 120; // re-layout once the window has stopped resizing for this long

function initControls() {
  initContextControls(); // first: its turn-arrow handler stops the click before the other handlers see it
  applyPageText();
  initLanguageMenu();
  initFilterControls();
  applyTheme();
  initHeaderButtons();
  initViewClicks();
  initViewHover();
  initDetailsControls();
  initSessionsControls();
  initOverviewControls();
  initHomeControls();
  initAlertControls();
  initContextAlertControls();
  initShortcutControls();
  initPointerHold();
  setInterval(() => { if (!state.frozen) scheduleRender('header', 'sessions', 'mid'); }, AGO_REFRESH_MS); // refresh "ago" labels
}

// the route and the overview are sized from their container, which follows the window height
function fitPanelsToWindow() {
  document.documentElement.style.setProperty('--ptop', Math.round(elementById('panels').getBoundingClientRect().top + scrollY) + 'px');
}

async function boot() {
  initControls();
  fitPanelsToWindow();
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      fitPanelsToWindow();
      measuredChartWidths = {};
      markViewDirty();
      scheduleRender('map', 'mid');
    }, RESIZE_SETTLE_MS);
  });
  setView(new URLSearchParams(location.search).get('layout') || storage.get(SETTING_KEYS.layout, 'home'), 'replace');
  await loadSessions();
  state.scope = sessionFromAddress() || state.scope;
  await loadScope();
  connectLiveUpdates();
  requestAnimationFrame(animationLoop);
}
void boot();
