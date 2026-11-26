'use strict';
// Session Observer dashboard — Details, its size: drag its left edge to resize it, or hide it to a slim rail, or
// widen it over the view. Both are remembered.
const DETAIL_WIDTH_DEFAULT = 380, DETAIL_WIDTH_MIN = 240, VIEW_WIDTH_MIN = 320, DETAIL_WIDTH_STEP = 24;
const DETAIL_SIZES = ['side', 'hidden', 'wide'];
let detailSize = 'side';

// the widest Details can be beside the view: the view keeps at least VIEW_WIDTH_MIN
function clampDetailWidth(width) {
  const panels = elementById('panels'), sessions = elementById('sessions');
  const max = panels.clientWidth - sessions.offsetWidth - VIEW_WIDTH_MIN - 2 * parseFloat(getComputedStyle(panels).columnGap || 0);
  return Math.round(Math.max(DETAIL_WIDTH_MIN, Math.min(width, max)));
}

const savedDetailWidth = () => Number(storage.get(SETTING_KEYS.detailWidth, DETAIL_WIDTH_DEFAULT)) || DETAIL_WIDTH_DEFAULT;

function setDetailWidth(width, remember = true) {
  const clamped = clampDetailWidth(width);
  elementById('panels').style.setProperty('--detail-w', clamped + 'px');
  elementById('detailSplit').setAttribute('aria-valuenow', clamped);
  if (remember) storage.set(SETTING_KEYS.detailWidth, String(clamped));
}

// the route and the overview are sized from their box: the page's resize handler redraws them
const relayoutView = () => dispatchEvent(new Event('resize'));

// the buttons in the Details header: hide it, and widen it over the view (or put it back at the side)
function detailSizeButtonsHtml() {
  const wide = detailSize === 'wide';
  return `<span class="dsize"><button id="detailWide" title="${escapeHtml(wide ? TEXT.detailNarrowTitle : TEXT.detailWideTitle)}" aria-pressed="${wide}">${wide ? '⇥' : '⇤'}</button>`
    + ` <button id="detailHide" title="${escapeHtml(TEXT.detailHideTitle)}">»</button></span>`;
}

function setDetailSize(size) {
  detailSize = DETAIL_SIZES.includes(size) ? size : 'side';
  storage.set(SETTING_KEYS.detailSize, detailSize);
  elementById('panels').dataset.detail = detailSize;
  renderDetails();
  relayoutView();
}

// drag the handle on Details' left edge; double-click puts the width back; ← / → step it from the keyboard
function initDetailSplitter() {
  const split = elementById('detailSplit');
  split.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    split.setPointerCapture(event.pointerId);
    const startX = event.clientX, startWidth = elementById('detailWrap').offsetWidth;
    document.body.classList.add('resizing');
    const move = moveEvent => setDetailWidth(startWidth + startX - moveEvent.clientX, false);
    const stop = () => {
      split.removeEventListener('pointermove', move);
      document.body.classList.remove('resizing');
      storage.set(SETTING_KEYS.detailWidth, String(elementById('detailWrap').offsetWidth));
      relayoutView();
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', stop, { once: true });
    split.addEventListener('pointercancel', stop, { once: true });
  });
  split.addEventListener('dblclick', () => { setDetailWidth(DETAIL_WIDTH_DEFAULT); relayoutView(); });
  split.addEventListener('keydown', event => {
    const step = event.key === 'ArrowLeft' ? DETAIL_WIDTH_STEP : event.key === 'ArrowRight' ? -DETAIL_WIDTH_STEP : 0;
    if (!step) return;
    event.preventDefault();
    setDetailWidth(elementById('detailWrap').offsetWidth + step);
    relayoutView();
  });
}

function initDetailSizeControls() {
  setDetailWidth(savedDetailWidth(), false);
  detailSize = DETAIL_SIZES.includes(storage.get(SETTING_KEYS.detailSize)) ? storage.get(SETTING_KEYS.detailSize) : 'side';
  elementById('panels').dataset.detail = detailSize;
  initDetailSplitter();
  elementById('detailWrap').addEventListener('click', event => {
    if (event.target.closest('#detailShow')) setDetailSize('side');
    else if (event.target.closest('#detailHide')) setDetailSize('hidden');
    else if (event.target.closest('#detailWide')) setDetailSize(detailSize === 'wide' ? 'side' : 'wide');
  });
  // the saved width may not fit a narrower window: fit it, and grow back to it when the window does
  addEventListener('resize', () => {
    const current = parseFloat(elementById('panels').style.getPropertyValue('--detail-w'));
    if (clampDetailWidth(savedDetailWidth()) !== current) setDetailWidth(savedDetailWidth(), false);
  });
}
