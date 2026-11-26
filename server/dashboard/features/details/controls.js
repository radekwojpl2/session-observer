'use strict';
// Session Observer dashboard — Details, the controls: opening rows, hover links, remembered sections, Prev / Next /
// Close, and the keys Esc, [ and ].
function toggleEventRow(seq, callSeq) {
  if (state.openEventSeqs.has(seq) || state.openEventSeqs.has(callSeq)) {
    state.openEventSeqs.delete(seq);
    state.openEventSeqs.delete(callSeq);
  } else {
    state.openEventSeqs.add(seq);
  }
  renderDetails();
}

function initDetailsPanel() {
  const panel = elementById('detail');
  panel.addEventListener('mouseover', event => {
    const row = event.target.closest('.frow[data-seq]'), seq = row ? Number(row.dataset.seq) : null;
    if (seq === hoveredDetailSeq) return;
    hoveredDetailSeq = seq;
    applyHoverHighlights();
    revealHighlighted();
  });
  panel.addEventListener('mouseleave', () => {
    if (hoveredDetailSeq == null) return;
    hoveredDetailSeq = null;
    applyHoverHighlights();
  });
  // remember which Details sections are open ('toggle' does not bubble, so listen in the capture phase)
  panel.addEventListener('toggle', event => {
    const id = event.target.dataset?.dsec;
    if (!id) return;
    detailSectionOpen[id] = event.target.open;
    storage.set(SETTING_KEYS.detailSections, JSON.stringify(detailSectionOpen));
  }, true);
  panel.onclick = event => {
    if (event.target.closest('#closeTurn')) return closeSelectedTurn();
    if (event.target.closest('#prevTurn')) return selectAdjacentTurn(-1);
    if (event.target.closest('#nextTurn')) return selectAdjacentTurn(1);
    if (event.target.closest('pre.raw, .evx')) return; // inside an open card
    const row = event.target.closest('.erow');
    if (!row) return;
    const seq = Number(row.id.slice(3)), callSeq = Number(row.dataset.pre);
    // beside the Context view a row click brings up its message there, and only the arrow opens or closes the row
    if (state.view === 'context' && !event.target.closest('.etog')) {
      if (!event.target.closest('.erh')) return;
      return focusContextMessage([callSeq, seq], state.events.find(other => other.seq === callSeq)?.ts);
    }
    toggleEventRow(seq, callSeq);
  };
}

// Esc closes the turn; [ and ] step through the turns
function initKeyboard() {
  document.addEventListener('keydown', event => {
    if (event.target.matches('input, select, textarea') || elementById('shortcuts').open) return;
    if (event.key === 'Escape') closeSelectedTurn();
    else if (event.key === '[') selectAdjacentTurn(-1);
    else if (event.key === ']') selectAdjacentTurn(1);
  });
}

function initDetailsControls() {
  initDetailsPanel();
  initDetailSizeControls();
  initKeyboard();
}
