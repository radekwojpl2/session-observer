'use strict';
// Session Observer dashboard — Compare, the controls: a session's column (remove it, make it the baseline, open it),
// the turns (open one to every step, open or close them all, show them all, open one on the Route) and the menu that
// adds a session. The sessions list's compare buttons are in features/sessions/controls.js.

// a turn opens on the Route, in its session (the turn keys are the same there)
async function openComparedTurn(button) {
  const { compareTurn: key, compareTurnSession: sessionId } = button.dataset;
  setView('route');
  if (state.scope !== sessionId) await selectScope(sessionId);
  if (findTurn(key)) selectTurn(key);
  viewNeedsDrawing = true;
}

function toggleComparedTurn(cell) {
  const turnIndex = Number(cell.dataset.compareToggleTurn);
  if (!compareOpenTurns.delete(turnIndex)) compareOpenTurns.add(turnIndex);
  markViewDirty();
}

// data-compare-open-all: how many turns to open from the first, or 0 to close them all
function openAllComparedTurns(button) {
  const count = Number(button.dataset.compareOpenAll);
  compareOpenTurns.clear();
  for (let turnIndex = 0; turnIndex < count; turnIndex++) compareOpenTurns.add(turnIndex);
  markViewDirty();
}

function initCompareControls() {
  loadCompareSelection();
  viewBox().addEventListener('click', event => {
    const remove = event.target.closest('[data-compare-remove]');
    if (remove) return uncompareSession(remove.dataset.compareRemove);
    const baseline = event.target.closest('[data-compare-baseline]');
    if (baseline) return makeCompareBaseline(baseline.dataset.compareBaseline);
    const turn = event.target.closest('[data-compare-turn]');
    if (turn) return openComparedTurn(turn);
    const toggle = event.target.closest('[data-compare-toggle-turn]');
    if (toggle) return toggleComparedTurn(toggle);
    const openAll = event.target.closest('[data-compare-open-all]');
    if (openAll) return openAllComparedTurns(openAll);
    if (event.target.closest('[data-compare-all-files]')) {
      compareAllFilesShown = true;
      return markViewDirty();
    }
    if (event.target.closest('[data-compare-all-turns]')) {
      compareAllTurnsShown = true;
      return markViewDirty();
    }
    const tab = event.target.closest('[data-compare-tab]');
    if (tab) {
      setCompareTab(tab.dataset.compareTab);
      return markViewDirty();
    }
    const context = event.target.closest('[data-compare-context]');
    if (context) {
      setView('context');
      return void selectScope(context.dataset.compareContext);
    }
    if (event.target.closest('[data-compare-wide]')) {
      setCompareWide(!compareWide);
      return setView('compare', 'none');
    }
    const open = event.target.closest('[data-compare-open]');
    if (!open) return;
    setView('overview');
    void selectScope(open.dataset.compareOpen);
  });
  viewBox().addEventListener('keydown', event => {
    const toggle = event.key === 'Enter' && event.target.closest('[data-compare-toggle-turn]');
    if (toggle) toggleComparedTurn(toggle);
  });
  viewBox().addEventListener('change', event => {
    const picker = event.target.closest('[data-compare-add]');
    if (!picker?.value) return;
    toggleCompared(picker.value);
    picker.blur(); // the view is not redrawn while its menu has the focus (app/views.js)
  });
}
