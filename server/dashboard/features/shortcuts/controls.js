'use strict';
// Session Observer dashboard — keyboard shortcuts: j / k step through the turns, J / K through the sessions, 0 goes
// to All activity, u to a session waiting on you, / to the search, 1 – 6 switch the view, ? opens the list of shortcuts. ([, ] and Esc are in features/details/controls.js.)
// Keys typed into a field, or held with Ctrl, Alt or Cmd, are left alone.
const isTypingIn = target => !!target.closest?.('input, select, textarea, [contenteditable=""], [contenteditable="true"]');

function toggleShortcutsDialog() {
  const dialog = elementById('shortcuts');
  if (dialog.open) return dialog.close();
  renderShortcutsDialog();
  dialog.showModal();
}

function handleShortcutKey(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
  if (event.key === '?' && !isTypingIn(event.target)) {
    event.preventDefault();
    return toggleShortcutsDialog();
  }
  if (elementById('shortcuts').open) return;
  if (isTypingIn(event.target)) {
    if (event.key === 'Escape' && event.target.id === 'q') event.target.blur(); // Esc leaves the search
    return;
  }
  const viewIndex = '123456'.indexOf(event.key);
  if (event.key === 'j') selectAdjacentTurn(1);
  else if (event.key === 'k') selectAdjacentTurn(-1);
  else if (event.key === 'J') selectAdjacentSession(1);
  else if (event.key === 'K') selectAdjacentSession(-1);
  else if (event.key === '0') selectSessionFromKeyboard(ALL_SESSIONS);
  else if (event.key === 'u') selectNextSessionNeedingYou();
  else if (viewIndex >= 0 && VIEWS[viewIndex]) setView(VIEWS[viewIndex].id);
  else if (event.key === '/') {
    elementById('q').focus();
    elementById('q').select();
  } else return;
  event.preventDefault();
}

function initShortcutControls() {
  document.addEventListener('keydown', handleShortcutKey);
  const button = elementById('keysHelp');
  button.title = TEXT.shortcuts.buttonTitle;
  button.setAttribute('aria-label', TEXT.shortcuts.buttonTitle);
  button.onclick = toggleShortcutsDialog;
  const dialog = elementById('shortcuts');
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-close-shortcuts]')) return dialog.close(); // the backdrop or ×
    const tab = event.target.closest('[data-shortcut-section]');
    if (!tab) return;
    shortcutSection = tab.dataset.shortcutSection;
    renderShortcutsDialog();
  });
}
