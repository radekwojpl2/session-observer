'use strict';
// Session Observer dashboard — Home, the controls: a session or a wait opens that session on its Route.
function initHomeControls() {
  viewBox().addEventListener('toggle', event => {
    const disclosure = event.target.closest('.harchive details[data-home-project]');
    if (!disclosure) return;
    const projectId = disclosure.dataset.homeProject;
    if (disclosure.open) homeExpandedProjects.add(projectId);
    else homeExpandedProjects.delete(projectId);
  }, true);
  viewBox().addEventListener('click', event => {
    const row = event.target.closest('[data-home-session]');
    if (!row) return;
    selectScope(row.dataset.homeSession);
    setView('route');
  });
}
