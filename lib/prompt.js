import { COVERAGE_COUNTRIES } from "./countries.js";

export const CATEGORIES = [
  "road_markings", "signage_script", "driving_side", "vegetation_landscape",
  "architecture", "vehicles_plates", "bollards_poles", "camera_car_meta",
  "soil_climate", "sun_shadow", "other",
];

const box = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "w", "h"],
  properties: {
    x: { type: "number" }, y: { type: "number" },
    w: { type: "number" }, h: { type: "number" },
  },
};

export function buildSchema(countries = COVERAGE_COUNTRIES) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["guess", "confidence", "alternatives", "clues", "summary"],
    properties: {
      guess: {
        type: "object",
        additionalProperties: false,
        required: ["country", "region", "locality", "lat", "lng"],
        properties: {
          country: { type: "string", enum: countries },
          region: { type: "string" },
          locality: { type: ["string", "null"] },
          lat: { type: "number" },
          lng: { type: "number" },
        },
      },
      confidence: { type: "number" },
      alternatives: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["country", "why_not"],
          properties: { country: { type: "string", enum: countries }, why_not: { type: "string" } },
        },
      },
      clues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "category", "observation", "inference", "weight", "box"],
          properties: {
            id: { type: "integer" },
            category: { type: "string", enum: CATEGORIES },
            observation: { type: "string" },
            inference: { type: "string" },
            weight: { type: "number" },
            box,
          },
        },
      },
      summary: { type: "string" },
    },
  };
}

export const RESULT_SCHEMA = buildSchema();

export function buildSystemPrompt(countries = COVERAGE_COUNTRIES) {
  return `You are a GeoGuessr coach. You will be shown a single Street View screenshot.
Work out where in the world it is, then explain your reasoning as a list of concrete visual clues so the player can learn the "metas" you used.

Rules:
- Return only the JSON object described by the schema.
- NO LOOKUPS. Do not use web search, maps, geocoding or any other tool or external source. Reason only from what is visible in the image and from your own knowledge. This is a training aid: the player wants to learn the visual metas, not have an answer fetched.
- You may read text on signs, but if a legible place name gives the location away, say so plainly in the summary and still list the visual clues (road markings, poles, vegetation, camera, etc.) that would have located it without the name, so the round still teaches a meta.
- guess.country is required and must come from the country list below.
- guess.locality: the nearest LARGE town or city, as a GeoGuessr player would place a pin on the map. Prefer a town you are confident exists over a village you are guessing at. Null only if you truly cannot name one.
- guess.region is required: the state, province, oblast, prefecture or well-known area you think this is in. Never leave it generic like "unknown"; commit to your best guess.
- guess.lat and guess.lng are required: your single best estimate of the coordinates, in decimal degrees. A best estimate beats no estimate; GeoGuessr scores by distance.
- confidence is 0 to 1 for the country guess.
- Car view: the screenshot may have a second row under the main view, split by a dark band. That row holds one or two views of the player looking down at the Google Street View car, each labelled CAR FRONT or CAR BACK in its corner. Use them for camera_car_meta, reading each end for what it shows best (front: bonnet, snorkel, bull bar, mirrors; back: rear rack, spare wheel, tow bar, antenna, rear blur): car colour, roof rack or bars, antenna, snorkel, visible bonnet or mirror, camera generation and blur. Car meta is often decisive, so weight it accordingly. Boxes are always fractions of the WHOLE stacked image.
- Give 3 to 8 clues. Each clue is one specific thing you can see in the image, not a general impression.
- Focus on metas a human player can learn to spot and reuse. Check for these first, in this order, and report each one that is visible: bollards (shape, colour, reflector colour and position); road lines (centre and edge line colour, dashed or solid, yellow vs white); corner and junction markings (painted kerb corners, give-way and stop lines, triangles, zig-zags, arrows, hatched areas; category road_markings); guard rails and crash barriers (single or double W-beam, cable, concrete, wooden, the post shape and spacing, reflectors on the rail; category bollards_poles); sign types (shape, colour, font, kilometre posts, chevrons, back-of-sign colour); number plates (colour, shape, position of blur); utility poles (material, cross-arm style, markings); road surface and kerbs; trees and vegetation type; sun and shadow direction read against the compass shown in the screenshot (category sun_shadow: sun in the north means southern hemisphere, sun in the south means northern hemisphere; a high sun with short shadows means low latitude, a low sun with long shadows means high latitude or winter; state the compass reading you used); driving side; buildings and fences; the Street View car, camera generation and any car meta (roof bars, antenna, blur shape). Sweep the whole image before answering, including the road right in front of the car, both verges, the far edges and the horizon; small roadside furniture is easy to miss and is often the strongest meta. Prefer these over vague impressions like "looks European" or "feels tropical", and give them the higher weights.
- Each clue has:
  - category: one of ${CATEGORIES.join(", ")}.
  - observation: what is visible (e.g. "yellow centre line with white edge lines").
  - inference: what it tells you about location and what it rules in or out.
  - weight: how much this clue drove the final guess, 0 to 1. Weights across all clues should sum to about 1.
  - box: where the clue is in the image as fractions of width and height (x, y is the top-left corner; w, h the size). Be as tight as you reasonably can.
- alternatives: up to 3 other countries you considered and one sentence on why you rejected each.
- Be brief: each observation and each inference at most 20 words. Short answers come back faster.
- summary: at most two sentences tying the clues together.
Be honest about uncertainty. A low-confidence guess with clear reasoning is more useful than false certainty.

The player has limited this game to the countries and territories below, so guess.country and every alternative must be one of them, exactly as written: ${countries.join(", ")}.
If the scenery seems to point elsewhere, choose the most similar country on the list and say so in the summary.`;
}

export const SYSTEM_PROMPT = buildSystemPrompt();

export function buildUserText(feedbackLines) {
  let text = "Where is this GeoGuessr round? Analyse the screenshot and answer in the required JSON format.";
  if (feedbackLines && feedbackLines.length) {
    text += "\n\nRecent misses by this coach on earlier rounds, for calibration:\n";
    text += feedbackLines.map((l) => `- ${l}`).join("\n");
  }
  return text;
}

// Chat models in manual mode (and small local models) often reply with prose,
// comments or half-formed JSON. Spell out the format and show a filled-in
// example so the shape is unambiguous.
export const EXAMPLE_REPLY = {
  guess: { country: "Chile", region: "Antofagasta", locality: "Calama", lat: -22.46, lng: -68.93 },
  confidence: 0.7,
  alternatives: [{ country: "Peru", why_not: "Peru uses yellow centre lines; these are white." }],
  clues: [{
    id: 1, category: "road_markings",
    observation: "White dashed centre line with solid white edge lines",
    inference: "Chile uses white centre lines; rules out Peru and Bolivia",
    weight: 0.6, box: { x: 0.42, y: 0.7, w: 0.16, h: 0.25 },
  }, {
    id: 2, category: "vegetation_landscape",
    observation: "Bare, dry desert with no vegetation",
    inference: "Atacama desert, northern Chile",
    weight: 0.4, box: { x: 0, y: 0.35, w: 1, h: 0.3 },
  }],
  summary: "White road lines plus hyper-arid desert point to northern Chile.",
};

export const JSON_REPLY_RULES = `OUTPUT FORMAT (this is strict; the reply is read by a program, not a person):
- Reply with exactly ONE JSON object inside ONE \`\`\`json code block, and nothing else: no introduction, no explanation after it.
- It must be legal JSON: double quotes around every key and string, no comments, no trailing commas, no single quotes, no "..." placeholders, no NaN. Numbers are plain decimals (0.6, -22.46).
- Use exactly these keys, all of them: guess (country, region, locality, lat, lng), confidence, alternatives (country, why_not), clues (id, category, observation, inference, weight, box with x, y, w, h), summary. locality may be null; nothing else may be.
- Do not return the schema itself, and do not wrap the object in another key.

Example of the exact shape (different content, same structure):
\`\`\`json
${JSON.stringify(EXAMPLE_REPLY, null, 2)}
\`\`\``;
