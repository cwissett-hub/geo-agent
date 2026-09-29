# Geo Meta Trainer

A self-contained Chrome extension for learning GeoGuessr metas.

Press a hotkey during a round and it screenshots what you see, asks a vision
model (Claude, OpenAI or Gemini) where it is, and shows you:

- the guess and confidence,
- every clue it used, boxed on the screenshot,
- how much weight each clue carried,
- its reasoning.

After the round you enter the real location. Each clue is scored as
supporting or misleading, and the round goes into a personal notebook so you
can see which metas actually work for you.

It is a training aid, not a live assistant. It never moves, pans or zooms the
viewer, so it is safe in NMPZ, and it never reads GeoGuessr's internals.

## Status

Design stage. See [the design spec](docs/superpowers/specs/2026-09-29-geo-meta-trainer-design.md).

## API keys

You supply your own keys in the extension's settings. They are stored in
Chrome's local extension storage and sent only to their own vendor. Never
commit keys to this repository.
