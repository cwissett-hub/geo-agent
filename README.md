# Geo Meta Trainer

A self-contained Chrome extension for learning GeoGuessr metas.

Press **Alt+G** during a round. The extension screenshots what you see, asks
a vision model where it is, and shows:

- the guess (country, region, nearest town where possible, and best-guess
  coordinates) and its confidence, with a map pinned at the guess so you can
  see where that region and town actually are,
- every clue it used, drawn as a numbered box on the screenshot,
- how much weight each clue carried, as a bar,
- its reasoning and the alternatives it rejected.

After the round, type the real location. The extension scores the round —
pass or fail, country hit, region hit, and distance in km — and each clue as
supporting or misleading. A round only **passes** when the country is right
*and* the region or town matches or the guess is within 500 km: the right
country thousands of km out (easy in Russia or Australia) is a fail. Results
are saved to a personal notebook. The Notebook tab shows
per-category clue reliability, each provider's pass and hit rates, and mean distance.
Recent misses are fed back into the next prompt.

Guesses are restricted to a list of countries. By default that is the
coverage list in `lib/countries.js`; **Settings → Countries** lets you untick
countries your map leaves out, or add ones GeoGuessr has added.

**Google car view.** Once the round is captured, you are free to move the
view. Look down at the **front** of the Google car and press **Alt+Shift+F**
(or *Capture front* in the car card), and/or turn round to the **back** and
press **Alt+Shift+B**. One end is enough. Then press *Analyse with car view*:
the shots are labelled CAR FRONT / CAR BACK, stacked under the main
screenshot, and the round is analysed once. The extension only takes
screenshots; it never moves the view. (NMPZ rounds don't let you look
around, so no car view there.)

**Car view first.** Some rounds are only solvable from the car. Turn on
**Settings → Car view first** and the first **Alt+G** only captures the main
view (nothing is sent). Add the car front/back with Alt+Shift+F / Alt+Shift+B,
then press **Alt+G again** (or *Analyse*) to send the round once, with or
without car shots. In manual mode, Copy image then gives the combined image.

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

### Firefox

Same code, different manifest (`manifest.firefox.json`: a Firefox sidebar
instead of Chrome's side panel, background scripts instead of a service
worker). Needs Firefox 140 or later.

1. `node scripts/build-firefox.mjs` (or `npm run build:firefox`). This writes
   `dist/firefox/` and `dist/geo-meta-trainer-firefox.zip`.
2. For a quick try: `about:debugging` -> **This Firefox** -> **Load Temporary
   Add-on** -> pick `dist/firefox/manifest.json`. Temporary add-ons are removed
   when Firefox closes.
3. To install it permanently, the zip must be signed by Mozilla: upload it at
   https://addons.mozilla.org/developers/ as "On your own" (unlisted). That is
   free and gives back a signed `.xpi` anyone can install.

The toolbar button or View -> Sidebar opens the panel. Shortcuts are changed in
`about:addons` -> gear menu -> **Manage Extension Shortcuts**. For a local
Ollama server, allow Firefox's origin too:
`OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*`.

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
| Local model | `qwen2.5vl:7b` | Optional | Your own server, no key | Free; runs on your GPU |

None of the chat subscriptions (ChatGPT Plus, claude.ai) include API access —
you bring your own key.

Keys are stored in Chrome's local extension storage on your machine and are
sent only to their own vendor. Never commit keys to this repository.

Turn on **Ask every enabled provider** in Settings to send one snapshot to
all configured models and compare their answers side by side.

### Local models

The **Local model** provider talks to any OpenAI-compatible server with a
vision model: Ollama (`http://localhost:11434/v1`, e.g. `ollama pull
qwen2.5vl:7b` or `gemma3`), LM Studio (`http://localhost:1234/v1`),
llama.cpp server or vLLM. Set the server URL and model name in Settings. If
Ollama answers 403, it is rejecting the extension's origin: set
`OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*` and restart Ollama.

### Speed

Most of the wait is the model writing its answer. The prompt asks for short
clues, GPT-5 models are sent `verbosity: "low"`, and **Settings → Image
size** can drop the screenshot to 1280 or 1024 px for a faster, slightly
less detailed read. With OpenAI, `gpt-5-mini` or `gpt-5-nano` on minimal
effort are the quickest.

## Manual mode (no key needed)

If you don't have a working API key, the Round view offers **Copy image**
and **Copy prompt** buttons. Paste both into any chat model (e.g. the
claude.ai or ChatGPT web UI), then paste its JSON reply back into the round.
The prompt ends with strict output rules and a filled-in example, and asks
for one JSON object in a ```` ```json ```` code block. The paste box also
copes with the usual slips: prose around the JSON, code fences, curly quotes
and trailing commas.
It renders and scores exactly like an API result. This needs the
`clipboardWrite` permission, which is already declared in the manifest.

## Screenshots

Screenshots are downscaled to 1600px (longest edge, configurable) JPEG before they are sent
to a provider or stored in the notebook.

## Development

```
npm test
```

Runs the unit tests with Node's built-in test runner (Node 24). Everything in
`lib/` is pure and tested; the UI is checked by hand in Chrome.

Design: [docs/superpowers/specs/2026-09-29-geo-meta-trainer-design.md](docs/superpowers/specs/2026-09-29-geo-meta-trainer-design.md)
Plan: [docs/superpowers/plans/2026-09-29-geo-meta-trainer.md](docs/superpowers/plans/2026-09-29-geo-meta-trainer.md)
