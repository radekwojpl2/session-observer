# Contributing

Thanks for helping with Session Observer. This page covers how to send a change.

## Before you start

- **Open an issue first** (or find an existing one) with the [bug](https://github.com/radekwojpl2/session-observer/issues/new?template=bug.yml)
  or [feature](https://github.com/radekwojpl2/session-observer/issues/new?template=feature.yml) form. Every pull
  request links an issue, so the reason for a change is agreed on before the code is written. A short issue is
  enough for a small fix.
- Security problems go through [private reporting](SECURITY.md), not a public issue.

## Work from a fork

All changes come in through forks.

1. Fork `radekwojpl2/session-observer` on GitHub.
2. Clone your fork and add this repository as `upstream`:

   ~~~sh
   git clone https://github.com/<you>/session-observer.git
   cd session-observer
   git remote add upstream https://github.com/radekwojpl2/session-observer.git
   ~~~

3. Branch from an up-to-date `main`:

   ~~~sh
   git fetch upstream
   git switch -c feat/my-change upstream/main
   ~~~

4. Commit, push to your fork, and open a pull request against `radekwojpl2/session-observer:main`.

## Rules for the code

[AGENTS.md](AGENTS.md) holds the project rules. In short:

- Zero dependencies and no build step: Node built-ins only, and the dashboard is plain browser scripts.
- `server/dashboard/**/*.js` share one global scope, start with `'use strict';`, and must be listed in
  `server/dashboard.html` in load order.
- Keep the layers: `building-blocks/` never use a feature; `features/<feature>/` group code by function; the
  dashboard's `app/` wires features together.
- The hook must never block or fail Claude: it always exits 0 and swallows errors.
- Files use CRLF line endings.
- New dashboard text goes into every translation file in `server/dashboard/building-blocks/language/translations/`,
  worded so it doesn't assume the reader's gender.

## Check your work

~~~sh
node test/check.js          # JSON parses, JS compiles, hooks and dashboard files line up
node --test test/*.test.js  # smoke tests: hook → log → server → HTTP API
~~~

To try your branch without touching an installed copy of the plugin, run its server on another port:

~~~sh
OBSERVER_PORT=4778 node server/server.js
~~~

## Commits and titles

Pull requests are squash-merged: your branch becomes one commit on `main`, titled with the pull request title.
release-please reads that title to pick the next version and write the changelog. That means:

- The pull request title is a [Conventional Commit](https://www.conventionalcommits.org/): `feat:`, `fix:`,
  `perf:`, `refactor:`, `docs:`, `test:`, `ci:`, `chore:`. Add `!` for a breaking change. CI checks it.
- Commit messages on your branch are up to you; they end up in the body of the squashed commit.
- To catch up with `main`, merge or rebase `upstream/main`, whichever you prefer.

## Opening the pull request

The [pull request template](.github/pull_request_template.md) asks for three things. CI checks that the first one
is there; proofs are for the reviewer, not checked by CI.

1. **A linked issue:** `Closes #123` (or `Fixes #123`), so the issue closes on merge.
2. **Proofs with annotations**, described below, or `N/A: <reason>` when nothing changes for users.
3. **What changed**, in a few bullets.

### Proofs

Proofs help the review of any change a user can see or feel: dashboard views, hook behaviour, server responses,
stored data. For changes that only touch tests, docs, CI or internals, write `N/A: <reason>` in the Proofs
section instead, for example `N/A: refactor, no behaviour change; covered by smoke tests`.

A proof shows the change working on real data, with annotations that point at what changed.

- **Use a real session.** Run a real Claude Code (or Codex) session, open your branch's dashboard on its data
  (`OBSERVER_PORT=4778`), and capture that. Don't build proofs from made-up fixtures or hand-written transcripts:
  the point is to show the feature on what the agent really writes.
- **Annotate every shot.** Mark the changed parts with boxes or arrows and numbered labels, and explain each number
  in the description (for example "1: new plan-mode badge on the turn row").
- **Show before and after** when you change something that already exists.
- **Match the change:** a screenshot (or a short GIF for interaction) for dashboard changes; terminal output, log
  lines or an HTTP response for hook and server changes.
- **Check for private data.** Crop or blur email addresses, tokens, private paths and project names you don't want
  public before you upload anything.

Drag the images into the pull request description on GitHub; don't commit proof images to the repository.
If the change alters the dashboard visibly, also update the README screenshots in `docs/`.

## Review

A maintainer reviews the pull request and may ask for changes. It is merged once CI passes and the review is
approved.
