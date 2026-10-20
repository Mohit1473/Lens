// Experience estimation. Lens never scores experience: it estimates years from what the
// resume says, compares that with the role's minimum, and shows the evidence so a person
// can judge. Years of experience can hint at age, so it is flagged for review, not penalised.

export type ExperienceEvidence = {
  start: number;
  end: number;
  kind: "stated" | "dates";
  snippet: string;
};

export type ExperienceEstimate = {
  years: number | null; // null when nothing usable was found
  method: "stated" | "dates" | "none";
  evidence: ExperienceEvidence[];
};

export type ExperienceStatus = "meets" | "below" | "unclear" | "not-required";

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};
const NUMBER = "(\\d{1,2}(?:\\.\\d)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "3 years of experience", "three+ years' professional experience", "5 yrs experience"
const STATED = new RegExp(`\\b${NUMBER}\\s*\\+?\\s*(?:years?|yrs?)['’]?\\s+(?:of\\s+)?(?:[a-z-]+\\s+){0,3}?experience\\b`, "gi");
// "2 years as a data analyst"
const STATED_AS = new RegExp(`\\b${NUMBER}\\s*\\+?\\s*(?:years?|yrs?)\\s+as\\s+an?\\b`, "gi");
// "Jan 2021 – Present", "2019 - 2023", "Mar 2018 to Jun 2020"
const RANGE = new RegExp(
  `(?:${MONTH}\\.?\\s+)?((?:19|20)\\d{2})\\s*(?:-|–|—|to)\\s*(?:(?:${MONTH}\\.?\\s+)?((?:19|20)\\d{2})|(present|current|now|today|date))`,
  "gi",
);
// Lines about study are not work experience.
const EDUCATION = /\b(university|college|school|bachelor|master'?s?|degree|diploma|b\.?sc|m\.?sc|phd|graduated|education|coursework|student)\b/i;
const NEGATED_BEFORE = /\b(?:no|not|without|lack(?:ing|s)?)\s+(?:\w+\s+){0,2}$/i;

// Requirement phrases in a job description: "3+ years of experience", "at least five years' experience",
// "minimum of 2 years experience", "2-4 years of experience" (the lower bound is used).
const REQUIRED = new RegExp(
  `\\b(?:at\\s+least\\s+|minimum(?:\\s+of)?\\s+|min\\.?\\s+)?${NUMBER}\\s*(?:\\+|plus)?\\s*(?:(?:-|–|to)\\s*\\d{1,2}\\s*)?(?:years?|yrs?)['’]?\\s+(?:of\\s+)?(?:[a-z-]+\\s+){0,3}?experience\\b`,
  "i",
);

function toNumber(value: string): number {
  const lower = value.toLowerCase();
  return WORD_NUMBERS[lower] ?? Number(lower);
}

function monthIndex(name: string | undefined): number | null {
  if (!name) return null;
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return index >= 0 ? index : null;
}

function lineAround(text: string, start: number, end: number): string {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const stop = text.indexOf("\n", end);
  const line = text.slice(from, stop < 0 ? text.length : stop).replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

/** Minimum years asked for in a job description, or null when it does not say. */
export function requiredYearsFromJob(job: string): number | null {
  const match = REQUIRED.exec(job);
  if (!match) return null;
  const years = toNumber(match[1]);
  return Number.isFinite(years) && years > 0 && years <= 40 ? years : null;
}

/** Estimate total years of work experience from a resume. */
export function estimateExperience(text: string, now: Date = new Date()): ExperienceEstimate {
  const evidence: ExperienceEvidence[] = [];

  // 1. Experience the candidate states directly.
  let stated = 0;
  for (const pattern of [STATED, STATED_AS]) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const start = match.index ?? 0;
      if (NEGATED_BEFORE.test(text.slice(Math.max(0, start - 40), start))) continue;
      const years = toNumber(match[1]);
      if (!Number.isFinite(years) || years <= 0 || years > 45) continue;
      stated = Math.max(stated, years);
      evidence.push({ start, end: start + match[0].length, kind: "stated", snippet: lineAround(text, start, start + match[0].length) });
    }
  }

  // 2. Date ranges in job history, merged so overlapping jobs are not double-counted.
  const nowMonths = now.getFullYear() * 12 + now.getMonth();
  const spans: Array<[number, number]> = [];
  for (const match of text.matchAll(new RegExp(RANGE.source, RANGE.flags))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const line = lineAround(text, start, end);
    if (EDUCATION.test(line)) continue;
    const fromMonths = Number(match[2]) * 12 + (monthIndex(match[1]) ?? 0);
    const toMonths = match[5] ? nowMonths : Number(match[4]) * 12 + (monthIndex(match[3]) ?? 0);
    if (!(toMonths > fromMonths) || toMonths > nowMonths + 1) continue;
    spans.push([fromMonths, toMonths]);
    evidence.push({ start, end, kind: "dates", snippet: line });
  }
  spans.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let current: [number, number] | null = null;
  for (const span of spans) {
    if (current && span[0] <= current[1]) current[1] = Math.max(current[1], span[1]);
    else {
      if (current) months += current[1] - current[0];
      current = [...span] as [number, number];
    }
  }
  if (current) months += current[1] - current[0];
  const fromDates = months / 12;

  evidence.sort((a, b) => a.start - b.start);
  if (!stated && !fromDates) return { years: null, method: "none", evidence };
  // Round down to the half year so nobody appears to meet a requirement they do not quite meet.
  const years = Math.floor(Math.max(stated, fromDates) * 2) / 2;
  return { years, method: fromDates >= stated ? "dates" : "stated", evidence };
}

export function experienceStatus(estimate: ExperienceEstimate, minYears: number | null): ExperienceStatus {
  if (minYears === null || minYears <= 0) return "not-required";
  if (estimate.years === null) return "unclear";
  return estimate.years >= minYears ? "meets" : "below";
}

export function formatYears(years: number | null): string {
  if (years === null) return "unclear";
  if (years < 1) return "<1 yr";
  return `~${years % 1 ? years.toFixed(1) : years} yr${years === 1 ? "" : "s"}`;
}
