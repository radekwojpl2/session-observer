'use strict';
// Session Observer dashboard — Filters, the controls: search, tool group, only problems, range, event-type chips.
const SEARCH_DELAY_MS = 150;

const refilter = () => scheduleRender('mid', 'detail', 'sessions', 'cats', 'map');


// the agent filter changes which events All activity loads, and which sessions the list shows
function setAgentFilter(agent) {
  state.agent = agent;
  elementById('agent').value = agent;
  storage.set(SETTING_KEYS.agent, agent);
  scheduleRender('sessions', 'cats');
  void loadScope();
}

function initFilterControls() {
  elementById('station').innerHTML = `<option value="">${escapeHtml(TEXT.allGroups)}</option>`
    + TOOL_GROUPS.map(group => `<option value="${group.id}">${escapeHtml(group.label)}</option>`).join('');
  state.rangeMs = setSelectValue('range', state.rangeMs, DEFAULT_RANGE_MS);
  state.agent = setSelectValue('agent', state.agent, '');
  state.sessionOrder = setSelectValue('sessionOrder', state.sessionOrder, 'started');
  elementById('sessionOrder').onchange = event => {
    state.sessionOrder = event.target.value;
    storage.set(SETTING_KEYS.sessionOrder, state.sessionOrder);
    scheduleRender('sessions');
  };

  let searchTimer;
  elementById('q').oninput = event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.searchText = event.target.value.trim().toLowerCase(); refilter(); }, SEARCH_DELAY_MS);
  };
  elementById('station').onchange = event => { state.group = event.target.value; refilter(); };
  elementById('problems').onchange = event => { state.onlyProblems = event.target.checked; refilter(); };
  elementById('agent').onchange = event => { setAgentFilter(event.target.value); };
  elementById('clearFilters').onclick = () => {
    if (state.agent) setAgentFilter('');
    state.searchText = state.group = state.category = '';
    state.onlyProblems = false;
    elementById('q').value = '';
    elementById('station').value = '';
    elementById('problems').checked = false;
    refilter();
  };
  elementById('range').onchange = event => {
    state.rangeMs = Number(event.target.value);
    storage.set(SETTING_KEYS.range, state.rangeMs);
    void loadScope();
  };
  elementById('cats').onclick = event => {
    const chip = event.target.closest('[data-cat]');
    if (!chip) return;
    state.category = state.category === chip.dataset.cat ? '' : chip.dataset.cat;
    refilter();
  };
}
