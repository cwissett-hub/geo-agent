// Countries and territories with official Google Street View coverage that
// appear in GeoGuessr's world map. Hand-maintained: coverage changes, so edit
// this list when GeoGuessr adds or drops a country. Display names only.
export const COVERAGE_COUNTRIES = [
  "Albania", "American Samoa", "Andorra", "Argentina", "Australia", "Austria",
  "Bangladesh", "Belgium", "Bermuda", "Bhutan", "Bolivia", "Botswana", "Brazil", "Bulgaria",
  "Cambodia", "Canada", "Chile", "Christmas Island", "Colombia", "Costa Rica", "Croatia", "Curaçao", "Czechia",
  "Denmark", "Dominican Republic",
  "Ecuador", "Egypt", "Estonia", "Eswatini",
  "Faroe Islands", "Finland", "France",
  "Germany", "Ghana", "Gibraltar", "Greece", "Greenland", "Guam", "Guatemala",
  "Hong Kong", "Hungary",
  "Iceland", "India", "Indonesia", "Ireland", "Isle of Man", "Israel", "Italy",
  "Japan", "Jersey", "Jordan",
  "Kazakhstan", "Kenya", "Kyrgyzstan",
  "Laos", "Latvia", "Lebanon", "Lesotho", "Liechtenstein", "Lithuania", "Luxembourg",
  "Macau", "Madagascar", "Malaysia", "Malta", "Martinique", "Mexico", "Monaco", "Mongolia", "Montenegro",
  "Netherlands", "New Zealand", "Nigeria", "North Macedonia", "Northern Mariana Islands", "Norway",
  "Oman",
  "Palestine", "Panama", "Peru", "Philippines", "Poland", "Portugal", "Puerto Rico",
  "Qatar",
  "Réunion", "Romania", "Russia", "Rwanda",
  "San Marino", "Senegal", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland",
  "Taiwan", "Thailand", "Tunisia", "Turkey",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "US Virgin Islands",
  "Vietnam",
];

const lookup = new Set(COVERAGE_COUNTRIES.map((c) => c.trim().toLowerCase()));

export function isCovered(name) {
  return lookup.has(String(name ?? "").trim().toLowerCase());
}
