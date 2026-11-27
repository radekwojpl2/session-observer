// The Session Observer plugin, running inside OpenCode (on Bun). OpenCode loads the small ES module setup.js writes
// into its plugin folder, which requires this file and exports createOpencodePlugin(). Every hook and bus event goes
// through translate.js into the same log as the hook commands (scripts/hook.js). Like a hook, it must never break
// OpenCode: every handler swallows its errors and returns nothing OpenCode would act on.
'use strict';
const path = require('path');
const { createOpencodeTranslator } = require('../translate');

const HOOK_SCRIPT = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'scripts', 'hook.js');
const AGENT = 'opencode';

const quietly = fn => async (...args) => { try { fn(...args); } catch { /* never reach OpenCode */ } };

function createOpencodePlugin() {
  return async () => {
    let hook = null;
    try { hook = require(HOOK_SCRIPT); } catch { return {}; } // no observer: no hooks, OpenCode runs as usual
    const translator = createOpencodeTranslator({
      emit: (eventName, sessionId, data, { native = null, parents = [], ts = null } = {}) =>
        hook.recordEvent({ ...data, session_id: sessionId, hook_event_name: eventName }, eventName, AGENT, parents, native, ts),
      // OpenCode runs on Bun: the dashboard server is started with the node on PATH
      onFirstSession: () => { hook.ensureServer('node').catch(() => {}); },
    });
    return {
      event: quietly(({ event }) => translator.event(event)),
      'chat.message': quietly((input, output) => translator.chatMessage(input, output)),
      'chat.params': quietly(input => translator.chatParams(input)),
      'experimental.chat.system.transform': quietly((input, output) => translator.systemTransform(input, output)),
      'tool.execute.before': quietly((input, output) => translator.toolBefore(input, output)),
      'tool.execute.after': quietly((input, output) => translator.toolAfter(input, output)),
      'permission.ask': quietly(input => translator.permissionAsk(input)),
      'experimental.text.complete': quietly((input, output) => translator.textComplete(input, output)),
      'experimental.session.compacting': quietly(input => translator.compacting(input)),
      'shell.env': quietly((input, output) => translator.shellEnv(input, output)),
      dispose: quietly(() => translator.dispose()),
    };
  };
}

module.exports = { createOpencodePlugin };
