'use strict';
// Session Observer dashboard — the views' controls: view tabs, clicks in the Route / Chat / Context box, and hover
// links to Details.
function initViewHover() {
  const box = viewBox();
  box.addEventListener('mouseover', event => {
    const line = event.target.closest('[data-ln]'), lineKey = line ? line.dataset.ln.split(' ')[0] : null;
    // a chat item, route stop or model-step diamond under the mouse lights up its rows in Details
    const item = event.target.closest('[data-seqs]');
    const seqs = item && item.dataset.seqs.trim() ? item.dataset.seqs.trim().split(/\s+/) : null;
    const seqsChanged = String(seqs) !== String(hoveredViewSeqs), lineChanged = lineKey !== hoveredLineKey;
    hoveredViewSeqs = seqs;
    hoveredLineKey = lineKey;
    if (!seqsChanged && !lineChanged) return;
    applyHoverHighlights();
    if (seqsChanged && seqs) revealHighlighted();
  });
  box.addEventListener('mouseleave', () => {
    if (!hoveredLineKey && !hoveredViewSeqs) return;
    hoveredLineKey = null;
    hoveredViewSeqs = null;
    applyHoverHighlights();
  });
}

function initViewClicks() {
  elementById('layouts').onclick = event => {
    const tab = event.target.closest('[data-layout]');
    if (tab) setView(tab.dataset.layout);
  };
  addEventListener('popstate', () => {
    const sessionId = sessionFromAddress();
    const scope = sessionId || ALL_SESSIONS;
    if (scope !== state.scope) void selectScope(scope);
    setView(new URLSearchParams(location.search).get('layout') || storage.get(SETTING_KEYS.layout, 'home'), 'none');
  });
  viewBox().addEventListener('click', event => {
    anchorRouteClick(event.target); // a click inside the route keeps what it clicked in place (views.js)
    if (event.target.closest('[data-follow]')) {
      state.selectedTurnKey = null;
      renderDetails();
      renderOverview();
      viewNeedsDrawing = true;
      return;
    }
    const turnToggle = event.target.closest('[data-tog]');
    if (turnToggle) {
      routeTurnOpen.set(turnToggle.dataset.tog, turnToggle.dataset.open !== '1');
      viewNeedsDrawing = true;
      return;
    }
    const turnLink = event.target.closest('[data-key]');
    if (turnLink) {
      selectTurn(turnLink.dataset.key);
      viewNeedsDrawing = true;
      return;
    }
    const eventLink = event.target.closest('[data-seq]');
    if (eventLink && selectTurnOfSeq(Number(eventLink.dataset.seq))) viewNeedsDrawing = true;
  });
}
