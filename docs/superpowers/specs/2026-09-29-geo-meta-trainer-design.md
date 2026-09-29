# Geo Meta Trainer - Design

Date: 2026-09-29

## Purpose

A Chrome extension that helps the user learn GeoGuessr "metas". On demand it
screenshots the current round, asks a vision model where it is, and shows:

- the guess and its confidence,
- every clue the model used, drawn as a box on the screenshot,
- the weight each clue carried in the decision,
- the model's reasoning.

After the round the user enters the actual location. Each clue is then scored
as supporting or misleading, and the round is stored in a personal notebook.
Over time the notebook shows which clue categories actually work, and recent
misses are fed back into the prompt.

It is a training aid, not a live assistant: it only runs when asked.

## Constraints

- Self-contained: one extension folder, plain JavaScript, Manifest V3, no build
  step, no bundler, no server. Loaded via "Load unpacked".
- NMPZ-safe: capture is a passive tab screenshot. The extension never pans,
  zooms, moves, or injects into the Street View viewer, and never reads
  GeoGuessr's internals. It works in any mode on any GeoGuessr plan.
- Single snapshot per analysis: exactly what is on screen when triggered.
- Multi-provider: Anthropic (Claude), OpenAI, and Google Gemini adapters from
  day one. Gemini's free tier is the default while keys are sorted out.
- API keys live in `chrome.storage.local` and are sent only to their own
  vendor's endpoint.

## Architecture

Four pieces inside one extension.

### 1. Capture
A keyboard shortcut (default Alt+G) or a side-panel button messages the
service worker, which calls `chrome.tabs.captureVisibleTab` on the active tab.
The PNG data URL is held in memory for the round so retries need no second
capture. The shortcut works with the panel closed and opens it with the result.

### 2. Analyse
The service worker assembles the prompt (fixed system prompt + clue category
list + JSON schema + recent-miss feedback), picks the active provider adapter,
and awaits a normalised `RoundResult`. Adapters are the only code that knows a
vendor's API shape. An "ask all" toggle sends the same snapshot to every
provider with a key and returns one result per provider.

### 3. Review (side panel)
Shows the screenshot with numbered, category-coloured clue boxes, a weight bar
per clue, the guess, confidence and summary, and an "actual location" field.
Clicking a bar highlights its box and vice versa. Saving the actual location
scores each clue and writes the round to the notebook.

### 4. Notebook
IndexedDB store of rounds: image, provider, model, result, actual answer, per-
clue verdicts, timestamp. Provides list/filter/stats views and JSON export and
import. Contributes up to 12 recent wrong rounds to the next prompt as one-line
summaries ("guessed Chile from yellow centre line; actual Peru").

## Result contract

Every adapter returns this shape. The UI and notebook depend only on it.

```json
{
  "guess": { "country": "Chile", "region": "Atacama", "lat": -23.6, "lng": -70.4 },
  "confidence": 0.7,
  "alternatives": [ { "country": "Peru", "why_not": "..." } ],
  "clues": [
    {
      "id": 1,
      "category": "road_markings",
      "observation": "Yellow centre line with white edge lines",
      "inference": "Common across the Americas, rules out most of Europe",
      "weight": 0.35,
      "box": { "x": 0.10, "y": 0.55, "w": 0.45, "h": 0.20 }
    }
  ],
  "summary": "Short paragraph of the overall reasoning"
}
```

- `region`, `lat`, `lng` are optional. `alternatives` may be empty.
- `box` coordinates are fractions of image width/height in 0..1.
- `weight` values are asked to sum to about 1 and are normalised before display.
- `category` is one of a fixed list given in the prompt:
  `road_markings`, `signage_script`, `driving_side`, `vegetation_landscape`,
  `architecture`, `vehicles_plates`, `bollards_poles`, `camera_car_meta`,
  `soil_climate`, `other`.

### JSON guarantees per provider
- Anthropic: structured outputs (`output_config.format`) with this schema.
- OpenAI: `response_format` with `json_schema`, strict.
- Gemini: `responseSchema` with `responseMimeType: application/json`.

A shared validator checks every response against the contract regardless of
provider. On failure the raw text is shown and the round is marked unparsed;
nothing is written to the notebook.

### Anthropic specifics
- Model `claude-opus-5` by default; model string is editable in settings.
- Calls go direct from the extension with the
  `anthropic-dangerous-direct-browser-access: true` header (required for
  browser-origin requests).
- Adaptive thinking left on; `output_config.effort` exposed in settings.
- `stop_reason` is checked before reading content; a `refusal` is surfaced as
  an error like any other.

## Side panel UI

Three views, switched by tabs at the top.

**Round view**
- Screenshot at panel width, boxes numbered and coloured by category.
- Weight bars (one per clue), guess + confidence, summary, alternatives.
- If "ask all" is on, one column per provider, same layout, side by side.
- "What was it actually?" field: country (required), region (optional), or
  pasted coordinates. Save button. Once saved the round is locked.
- Error state: plain message + Retry button. Retry reuses the held screenshot.

**Notebook view**
- Rounds newest first: thumbnail, provider, guess, actual, hit/miss.
- Filters: country, clue category, provider.
- Stats block: hit rate per clue category, hit rate per provider, total rounds.

**Settings**
- Per provider: API key, model string, enabled flag.
- Active provider, "ask all" toggle.
- Anthropic effort level.
- Shortcut reminder with link to `chrome://extensions/shortcuts`.
- Export notebook to JSON, import from JSON, clear notebook (confirm).

## Clue scoring

When the actual location is saved:
- Round is a hit if guessed country equals actual country.
- A clue is `supporting` if the round was a hit, or if its inference names the
  actual country/region. Otherwise `misleading`. Simple and deterministic;
  can be refined later.

## Error handling

| Case | Behaviour |
|---|---|
| No key for active provider | Message pointing to Settings |
| HTTP 401/403 | "Key rejected" message |
| HTTP 429 | "Rate limited, try again shortly" with Retry |
| Network failure / 5xx | Generic failure with Retry |
| Unparseable output | Raw text shown, round marked unparsed, not saved |
| Refusal (Anthropic) | Shown as an error with the category |
| Capture fails (not a normal tab) | Message explaining it needs a web page |

## Testing

- Provider adapters split into pure request-builder and response-parser
  functions; both unit-tested with Node's built-in test runner using recorded
  fixture responses. No network in tests.
- Result validator and weight normaliser unit-tested.
- Clue scoring unit-tested.
- Notebook prompt-feedback summariser unit-tested.
- UI checked by hand in Chrome. No automated UI tests.

## File layout

```
geo-meta-trainer/
  manifest.json
  background.js            service worker: capture, analyse, messaging
  sidepanel.html
  sidepanel.js             view switching, round view, notebook, settings
  sidepanel.css
  lib/
    prompt.js              system prompt, categories, schema, feedback merge
    providers/
      anthropic.js
      openai.js
      gemini.js
      index.js             registry + shared fetch/error mapping
    validate.js            contract validator + weight normalise
    score.js               clue scoring
    notebook.js            IndexedDB wrapper, stats, export/import
  test/                    node --test
  docs/superpowers/specs/
```

## Out of scope (for now)

- Multi-direction panorama sweep.
- Any interaction with GeoGuessr's page or API (auto-reading the true answer).
- Hosted backend or sync between machines.
- Fine-tuning any model.
