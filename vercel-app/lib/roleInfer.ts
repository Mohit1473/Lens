// Reads a free-text job description and suggests the rest of the role brief: job title,
// seniority, minimum years, employment type and location. Used by the
// "Write my own role" form so a recruiter only has to write the description. Every
// suggestion is shown in an editable field, and anything the recruiter types wins.

import { requiredYearsFromJob } from "./experience";
import type { EmploymentType, Seniority } from "./templates";

export type InferredRole = {
  title: string | null;
  seniority: Seniority | null; // null when neither a level word nor years were found
  minYears: number | null;
  employmentType: EmploymentType | null;
  location: string | null;
};

// Words a job title usually ends with; used to trim "data analyst to join" to "data analyst".
const ROLE_NOUNS = new Set([
  "analyst", "developer", "engineer", "scientist", "manager", "designer", "consultant", "specialist",
  "administrator", "architect", "lead", "officer", "coordinator", "associate", "intern", "assistant",
  "accountant", "executive", "representative", "advisor", "adviser", "tester", "programmer", "technician",
  "director", "head", "owner", "writer", "researcher", "strategist", "marketer", "partner", "auditor",
  "controller", "planner", "operator", "agent", "recruiter", "trainer", "teacher", "nurse", "editor",
  "producer", "steward", "statistician", "economist", "actuary", "modeller", "modeler", "buyer", "clerk",
  "supervisor", "practitioner", "generalist", "receptionist", "lawyer", "paralegal", "graduate",
]);
const ACRONYMS: Record<string, string> = {
  bi: "BI", ml: "ML", ai: "AI", qa: "QA", ux: "UX", ui: "UI", it: "IT", hr: "HR", sql: "SQL", etl: "ETL",
  crm: "CRM", seo: "SEO", aws: "AWS", gis: "GIS", erp: "ERP", sap: "SAP", ios: "iOS", devops: "DevOps",
  fintech: "FinTech", "full-stack": "Full-Stack", "front-end": "Front-End", "back-end": "Back-End", nlp: "NLP",
};
const SMALL_WORDS = new Set(["of", "and", "&", "for", "the", "in"]);

const LEVEL_WORDS: Array<[RegExp, Seniority]> = [
  [/\b(?:senior|sr\.?|principal|staff|lead|head\s+of)\b/i, "Senior"],
  [/\b(?:mid[- ]?level|intermediate)\b/i, "Mid-level"],
  [/\b(?:junior|jr\.?)\b/i, "Junior"],
  [/\b(?:graduate|grad|entry[- ]level)\b/i, "Graduate"],
];
// Level words removed from the title because the Seniority field carries them ("Lead" stays).
const STRIP_LEVEL = /^(?:(?:senior|sr\.?|junior|jr\.?|graduate|grad|entry[- ]level|mid[- ]?level|intermediate|principal|experienced|talented|motivated|skilled|passionate|driven|dynamic|enthusiastic|highly\s+\w+|detail[- ]oriented|results[- ]driven|proactive|strong|new)\s+)+/i;

// "We are seeking a data analyst with…", "hiring an ML engineer to…", "join our team as a BI analyst"
const INTRO = /\b(?:seeking|hiring|looking\s+for|searching\s+for|recruiting|(?:we|i)\s+(?:need|want|require)|requires?|join\s+(?:us|our\s+(?:\w+\s+)?team|[A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,3})\s+as|as\s+(?:our|the)\s+(?:new\s+)?|role\s+(?:of|for)|position\s+(?:of|for))\s+(?:(?:an?|one|two|our|the)\s+)?([a-z][\w&/+.-]*(?:\s+[\w&/+.-]+){0,7})/i;
// Last resort: "As a data analyst, you will…", "internship for a data science intern"
const AS_A = /\b(?:as|for)\s+an?\s+([a-z][\w&/+.-]*(?:\s+[\w&/+.-]+){0,7})/i;
// "Job title: Data Analyst", "Role - Data Analyst", "Position: Data Analyst"
const LABELLED = /^\s*(?:job\s+title|title|role|position)\s*[:\-–]\s*(.+)$/im;
const STOP_WORDS = /^(?:with|who|to|that|for|in|on|at|based|located|from|and|or|will|you|is|are|whose|which|having|able|ready|responsible|needed|required|join|working|starting)$/i;

const EMPLOYMENT: Array<[RegExp, EmploymentType]> = [
  [/\b(?:internship|intern(?:s)?)\b/i, "Internship"],
  [/\bcasual\b/i, "Casual"],
  [/\bpart[- ]?time\b/i, "Part-time"],
  [/\b(?:contract(?:or)?(?!\s+(?:management|negotiation|law|review))|fixed[- ]term|temporary|temp\s+role)\b/i, "Contract"],
  [/\b(?:full[- ]?time|permanent)\b/i, "Full-time"],
];

const CITIES = [
  "Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Canberra", "Hobart", "Darwin", "Gold Coast",
  "Newcastle", "Parramatta", "Geelong", "Wollongong", "Auckland", "Wellington", "Singapore", "London",
  "Manchester", "Dublin", "Bengaluru", "Bangalore", "Mumbai", "Delhi", "New Delhi", "Hyderabad", "Chennai",
  "Pune", "Kolkata", "Noida", "Gurugram", "Gurgaon", "Mysuru", "Mysore", "Dubai", "Toronto", "Vancouver",
  "New York", "San Francisco", "Seattle", "Austin", "Boston", "Chicago",
];
const PLACE = /\b(?:based\s+(?:in|out\s+of)|located\s+in|office\s+in|offices\s+in|work\s+from\s+our|in\s+our)\s+([A-Z][a-zA-Z]+(?:[ -][A-Z][a-zA-Z]+){0,2}(?:,\s*[A-Z]{2,3})?)/;
const WORK_MODE: Array<[RegExp, string]> = [
  [/\bhybrid\b/i, "hybrid"],
  [/\b(?:fully\s+)?remote(?:ly)?\b/i, "remote"],
  [/\b(?:on[- ]?site|in[- ]office|office[- ]based)\b/i, "on-site"],
];


function titleCase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      if (word !== lower) return word; // keep the writer's own capitals, e.g. "DevOps", "Power BI"
      return lower.replace(/(^|[-/])([a-z])/g, (_, sep: string, letter: string) => sep + letter.toUpperCase());
    })
    .join(" ");
}

/** Trim a candidate phrase to the job title it starts with, or null if it does not look like one. */
function cleanTitle(raw: string): string | null {
  let words = raw.replace(/[,.;:()!?\n][\s\S]*$/, "").trim().split(/\s+/);
  const stop = words.findIndex((word, index) => index > 0 && STOP_WORDS.test(word));
  if (stop > 0) words = words.slice(0, stop);
  let phrase = words.join(" ").replace(STRIP_LEVEL, "").trim();
  words = phrase.split(/\s+/);
  // Keep up to the last word that names a role ("data analyst" from "data analyst passionate about…").
  let last = -1;
  words.forEach((word, index) => { if (ROLE_NOUNS.has(word.toLowerCase().replace(/s$/, ""))) last = index; });
  if (last < 0 || last > 5) return null;
  phrase = words.slice(0, last + 1).join(" ").replace(/s$/i, (s) => (/(?:analyst|engineer|developer|scientist|manager|designer)s$/i.test(words[last]) ? "" : s));
  return phrase ? titleCase(phrase) : null;
}

function inferTitle(text: string): { title: string | null; phrase: string } {
  const labelled = LABELLED.exec(text);
  if (labelled) {
    const title = cleanTitle(labelled[1]);
    if (title) return { title, phrase: labelled[1] };
  }
  const intro = INTRO.exec(text);
  if (intro) {
    const title = cleanTitle(intro[1]);
    if (title) return { title, phrase: intro[1] };
  }
  const asA = AS_A.exec(text);
  if (asA) {
    const title = cleanTitle(asA[1]);
    if (title) return { title, phrase: asA[1] };
  }
  // Fallback: the first short line, if it reads like a title ("Senior Data Engineer").
  const firstLine = text.trim().split("\n")[0] ?? "";
  if (firstLine.split(/\s+/).length <= 6) {
    const title = cleanTitle(firstLine);
    if (title) return { title, phrase: firstLine };
  }
  return { title: null, phrase: "" };
}

function inferSeniority(phrase: string, text: string, years: number | null): Seniority | null {
  for (const [pattern, level] of LEVEL_WORDS) if (pattern.test(phrase)) return level;
  if (/\b(?:graduate|entry[- ]level)\s+(?:role|position|program(?:me)?|opportunity|intake)\b/i.test(text)) return "Graduate";
  if (/\bno\s+(?:prior\s+)?experience\s+(?:is\s+)?(?:required|needed|necessary)\b/i.test(text)) return "Graduate";
  if (years === null) return null;
  if (years >= 5) return "Senior";
  if (years >= 2) return "Mid-level";
  if (years >= 1) return "Junior";
  return "Graduate";
}

function inferLocation(text: string): string | null {
  const place = PLACE.exec(text)?.[1] ?? CITIES.find((city) => new RegExp(`\\b${city}\\b`).test(text)) ?? null;
  const mode = WORK_MODE.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  if (place && mode) return `${place} (${mode})`;
  if (place) return place;
  if (mode) return mode.charAt(0).toUpperCase() + mode.slice(1);
  return null;
}


/** Suggest the role brief fields from a job description. Fields it cannot find are null. */
export function inferRole(text: string): InferredRole {
  const { title, phrase } = inferTitle(text);
  const minYears = requiredYearsFromJob(text);
  const employmentType = EMPLOYMENT.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  return {
    title,
    seniority: inferSeniority(phrase, text, minYears) ?? (employmentType === "Internship" ? "Graduate" : null),
    minYears,
    employmentType: employmentType ?? (title && /\bintern\b/i.test(title) ? "Internship" : null),
    location: inferLocation(text),
  };
}
