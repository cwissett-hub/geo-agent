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
      required: ["country", "region", "lat", "lng"],
      properties: {
        country: { type: "string" },
        region: { type: ["string", "null"] },
        lat: { type: ["number", "null"] },
        lng: { type: ["number", "null"] },
      },
    },
    confidence: { type: "number" },
    alternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["country", "why_not"],
        properties: { country: { type: "string" }, why_not: { type: "string" } },
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
- guess.country is required. Add region, lat and lng when you have a real basis for them, otherwise null.
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
Be honest about uncertainty. A low-confidence guess with clear reasoning is more useful than false certainty.`;

export function buildUserText(feedbackLines) {
  let text = "Where is this GeoGuessr round? Analyse the screenshot and answer in the required JSON format.";
  if (feedbackLines && feedbackLines.length) {
    text += "\n\nRecent misses by this coach on earlier rounds, for calibration:\n";
    text += feedbackLines.map((l) => `- ${l}`).join("\n");
  }
  return text;
}
