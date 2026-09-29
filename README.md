# Geo Meta Trainer

A self-contained Chrome extension for learning GeoGuessr metas.

Press **Alt+G** during a round. The extension screenshots what you see, asks
a vision model where it is, and shows:

- the guess (country, region, nearest town where possible, and best-guess
  coordinates) and its confidence,
- every clue it used, drawn as a numbered box on the screenshot,
- how much weight each clue carried, as a bar,
- its reasoning and the alternatives it rejected.

After the round, type the real location. The extension scores the round —
country hit, region hit, and distance in km — and each clue as supporting or
misleading, then saves it to a personal notebook. The Notebook tab shows
per-category clue reliability, each provider's hit rate, and mean distance.
Recent misses are fed back into the next prompt.

Guesses are restricted to a hand-maintained list of GeoGuessr coverage
countries in `lib/countries.js`. Edit that file when GeoGuessr's coverage
changes.

It is a training aid, not a live assistant. It only runs when you ask, never
moves, pans or zooms the viewer (safe in NMPZ), and never reads GeoGuessr's
page internals.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
3. Open the side panel from the toolbar icon, go to **Settings**, paste an API key.
4. If Alt+G clashes with something, rebind it at `chrome://extensions/shortcuts`.
5. For a bigger view, use the "Open in a full tab" button in the side panel — handy on big monitors.

No build step. No server. Nothing is installed.

### If "Load unpacked" is blocked by a corporate Chrome policy

Run `launch-chromium.cmd` in the repo folder. It starts the standalone Chromium
that Playwright installs (`npx playwright install chromium` once, if you don't
have it) with the extension pre-loaded and its own profile in
`.chromium-profile`, so GeoGuessr logins, keys and the notebook persist between
launches. That Chromium is not Google Chrome, so Chrome's managed policies do
not apply to it. Keep the profile folder on a normal disk path: IndexedDB
failed to open when the profile lived under a temp directory.

## Providers

| Provider | Model | Default state | Where to get a key | Cost |
|---|---|---|---|---|
| OpenAI | `gpt-5` | Enabled by default | https://platform.openai.com | Pay as you go; make a project API key |
| Claude | `claude-opus-5` | Optional, disabled until a key is added | https://console.anthropic.com | Pay as you go, roughly 2-3p per snapshot |
| Gemini | `gemini-2.5-flash` | Optional, disabled until a key is added | https://aistudio.google.com/apikey | Free tier with rate limits (personal Google accounts; often blocked on corporate accounts) |

None of the chat subscriptions (ChatGPT Plus, claude.ai) include API access —
you bring your own key.

Keys are stored in Chrome's local extension storage on your machine and are
sent only to their own vendor. Never commit keys to this repository.

Turn on **Ask every enabled provider** in Settings to send one snapshot to
all configured models and compare their answers side by side.

## Manual mode (no key needed)

If you don't have a working API key, the Round view offers **Copy image**
and **Copy prompt** buttons. Paste both into any chat model (e.g. the
claude.ai or ChatGPT web UI), then paste its JSON reply back into the round.
It renders and scores exactly like an API result. This needs the
`clipboardWrite` permission, which is already declared in the manifest.

## Screenshots

Screenshots are downscaled to 1600px (longest edge) JPEG before they are sent
to a provider or stored in the notebook.

## Development

```
npm test
```

Runs the unit tests with Node's built-in test runner (Node 24). Everything in
`lib/` is pure and tested; the UI is checked by hand in Chrome.

Design: [docs/superpowers/specs/2026-09-29-geo-meta-trainer-design.md](docs/superpowers/specs/2026-09-29-geo-meta-trainer-design.md)
Plan: [docs/superpowers/plans/2026-09-29-geo-meta-trainer.md](docs/superpowers/plans/2026-09-29-geo-meta-trainer.md)
