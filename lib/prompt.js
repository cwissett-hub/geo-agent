import { COVERAGE_COUNTRIES } from "./countries.js";

export const CATEGORIES = [
  "road_markings", "signage_script", "driving_side", "vegetation_landscape",
  "architecture", "vehicles_plates", "bollards_poles", "camera_car_meta",
  "soil_climate", "other",
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

export const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["guess", "confidence", "alternatives", "clues", "summary"],
  properties: {
    guess: {
      type: "object",
      additionalProperties: false,
      required: ["country", "region", "locality", "lat", "lng"],
      properties: {
        country: { type: "string", enum: COVERAGE_COUNTRIES },
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
        properties: { country: { type: "string", enum: COVERAGE_COUNTRIES }, why_not: { type: "string" } },
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

export const SYSTEM_PROMPT = `You are a GeoGuessr coach. You will be shown a single Street View screenshot.
Work out where in the world it is, then explain your reasoning as a list of concrete visual clues so the player can learn the "metas" you used.

Rules:
- Return only the JSON object described by the schema.
- guess.country is required and must come from the coverage list below.
- guess.region is required: the state, province, oblast, prefecture or well-known area you think this is in. Never leave it generic like "unknown"; commit to your best guess.
- guess.locality: the nearest town or city if you can name one, otherwise null.
- guess.lat and guess.lng are required: your single best estimate of the coordinates, in decimal degrees. A best estimate beats no estimate; GeoGuessr scores by distance.
- confidence is 0 to 1 for the country guess.
- Give 3 to 8 clues. Each clue is one specific thing you can see in the image, not a general impression.
- Each clue has:
  - category: one of ${CATEGORIES.join(", ")}.
  - observation: what is visible (e.g. "yellow centre line with white edge lines").
  - inference: what it tells you about location and what it rules in or out.
  - weight: how much this clue drove the final guess, 0 to 1. Weights across all clues should sum to about 1.
  - box: where the clue is in the image as fractions of width and height (x, y is the top-left corner; w, h the size). Be as tight as you reasonably can.
- alternatives: up to 3 other countries you considered and one sentence on why you rejected each.
- summary: two or three sentences tying the clues together.
Be honest about uncertainty. A low-confidence guess with clear reasoning is more useful than false certainty.

Only these countries and territories have Street View coverage in GeoGuessr, so the answer must be one of them, exactly as written: ${COVERAGE_COUNTRIES.join(", ")}.
If the scenery seems to point elsewhere, choose the most similar covered country and say so in the summary.`;

export function buildUserText(feedbackLines) {
  let text = "Where is this GeoGuessr round? Analyse the screenshot and answer in the required JSON format.";
  if (feedbackLines && feedbackLines.length) {
    text += "\n\nRecent misses by this coach on earlier rounds, for calibration:\n";
    text += feedbackLines.map((l) => `- ${l}`).join("\n");
  }
  return text;
}
