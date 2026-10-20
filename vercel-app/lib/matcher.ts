export type Candidate = { id: string; text: string; role?: string };

export type RankedCandidate = Candidate & {
  score: number;
  skillCoverage: number;
  keywordCoverage: number;
  textSimilarity: number;
  matchedSkills: string[];
  missingSkills: string[];
  missingMustHaves: string[];
  meetsMustHaves: boolean;
  /** Match-score points contributed by each component (they add up to `score`). */
  points: { skills: number; keywords: number; text: number };
  /** Which formula was used: "skills" when the job names catalogue skills, otherwise "fallback". */
  formula: "skills" | "fallback";
};

/** One mention of a skill in a resume, with the sentence it came from. */
export type Evidence = {
  skill: string;
  start: number;
  end: number;
  negated: boolean; // e.g. "no Python experience" - shown but not counted
  snippet: string;
};

export const SCORE_WEIGHTS = { skills: 0.65, keywords: 0.2, text: 0.15 };
export const FALLBACK_WEIGHTS = { skills: 0, keywords: 0.75, text: 0.25 };

const patterns: Record<string, RegExp> = {
  Python: /\bpython\b/i,
  SQL: /\bsql\b|\bmysql\b|\bpostgres(?:ql)?\b|\bsqlite\b/i,
  Excel: /\b(?:Excel|EXCEL)\b(?!\s+(?:in|at|as|under|when)\b)|\b(?:ms|microsoft|advanced|proficient\s+in|using|in|with)\s+excel\b|\bexcel\s+(?:spreadsheets?|workbooks?|formulas?|vba|macros?|pivot|dashboards?|reports?|reporting|models?|skills?)\b/,
  Tableau: /\btableau\b/i,
  "Power BI": /\bpower\s*bi\b/i,
  "Data visualisation": /\b(?:data\s+visuali[sz]ation|tableau|power\s*bi|dashboards?|matplotlib|seaborn|plotly)\b/i,
  Statistics: /\b(?:statistic(?:s|al)?|a\/b\s+test(?:s|ing)?|hypothesis\s+test(?:s|ing)?)\b/i,
  "Machine learning": /\bmachine\s+learning\b|\bml\s+(?:models?|pipelines?|algorithms?|engineering|ops)\b/i,
  Pandas: /\bpandas\b/i,
  NumPy: /\bnumpy\b/i,
  AWS: /\baws\b|\bamazon\s+web\s+services\b/i,
  Azure: /\bazure\b/i,
  Django: /\bdjango\b/i,
  Flask: /\bflask\b/i,
  Java: /\bjava\b/i,
  JavaScript: /\bjavascript\b|\btypescript\b/i,
  React: /\breact(?:\.js|js)\b|\breact\s+(?:developer|framework|components?|applications?|apps?|library)\b|\b(?:tech\s+stack|skills?|technologies|tools?)\s*:\s*[^.!?\n]*\breact\b/i,
  Git: /\bgit(?:hub|lab)?\b/i,
  Docker: /\bdocker\b/i,
  "REST APIs": /\brest(?:ful)?\s+api(?:s)?\b|\bapi\s+(?:design|development|integration|integrations|endpoints?|gateway|testing)\b/i,
  "Project management": /\bproject\s+management\b/i,
};

const boundary = /[.!?;,\n•]|\b(?:but|however|yet|although|and)\b/gi;
const negation = /\b(?:no|not|never|without|lack(?:ing|s)?|unfamiliar)\b|n't\b|\bwilling\s+to\s+learn\b/i;

/** True when a negation word appears before `index` in the same clause. */
function isNegatedAt(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const boundaries = [...before.matchAll(boundary)];
  const start = boundaries.length ? (boundaries.at(-1)?.index ?? 0) + (boundaries.at(-1)?.[0].length ?? 0) : 0;
  return negation.test(text.slice(start, index));
}

function globalCopy(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
}

function affirmed(text: string, pattern: RegExp): boolean {
  for (const match of text.matchAll(globalCopy(pattern))) {
    if (!isNegatedAt(text, match.index ?? 0)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Catalogue pattern for a skill, or a whole-word pattern for a recruiter-added skill. */
function patternFor(skill: string): RegExp {
  return patterns[skill] ?? new RegExp(`\\b${escapeRegExp(skill)}\\b`, "i");
}

function textShowsSkill(text: string, skill: string): boolean {
  return affirmed(text, patternFor(skill));
}

/**
 * Index just after the nearest sentence boundary before `from` (searching backwards), or
 * the nearest boundary at/after `from` (searching forwards). Sentence punctuation and bullets
 * are boundaries; a line break counts only when the next line starts like a new item
 * (capital letter, digit or bullet), so PDF lines wrapped mid-sentence stay joined.
 */
function isBoundary(text: string, index: number): boolean {
  const char = text[index];
  if (".!?•;".includes(char)) return true;
  if (char !== "\n") return false;
  const next = text.slice(index + 1).trimStart()[0] ?? "";
  return next === "" || /[A-Z0-9•\-*]/.test(next);
}

/** The sentence around a match, joined onto one line and trimmed for display. */
function sentenceAround(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && !isBoundary(text, from - 1)) from -= 1;
  let to = end;
  while (to < text.length && !isBoundary(text, to)) to += 1;
  let sentence = text.slice(from, to).replace(/\s+/g, " ").trim();
  if (sentence.length > 220) {
    const offset = text.slice(from, start).replace(/\s+/g, " ").trimStart().length;
    const windowStart = Math.max(0, offset - 90);
    sentence = `${windowStart > 0 ? "…" : ""}${sentence.slice(windowStart, windowStart + 200).trim()}…`;
  }
  return sentence;
}

/**
 * Every mention of the given skills in a resume, including negated ones, so the UI
 * can highlight exactly what was (and was not) counted.
 */
export function findEvidence(text: string, skills: string[]): Evidence[] {
  const found: Evidence[] = [];
  for (const skill of skills) {
    for (const match of text.matchAll(globalCopy(patternFor(skill)))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (end === start) continue;
      found.push({ skill, start, end, negated: isNegatedAt(text, start), snippet: sentenceAround(text, start, end) });
    }
  }
  // Keep one span per text position (a broad skill such as "Data visualisation" can
  // overlap "Tableau"); prefer the span that is counted and the longer one.
  found.sort((a, b) => a.start - b.start || Number(a.negated) - Number(b.negated) || b.end - a.end);
  return found;
}

export function recogniseSkills(text: string): string[] {
  return Object.entries(patterns)
    .filter(([, pattern]) => affirmed(text, pattern))
    .map(([skill]) => skill);
}

function meaningfulWords(text: string): Set<string> {
  const stop = new Set(["about", "after", "against", "and", "are", "for", "from", "has", "have", "into", "its", "our", "that", "the", "their", "this", "with", "your"]);
  return new Set((text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((word) => !stop.has(word)));
}

function cosineSimilarity(left: string, right: string): number {
  const leftWords = [...meaningfulWords(left)];
  const rightWords = [...meaningfulWords(right)];
  const vocabulary = new Set([...leftWords, ...rightWords]);
  if (!vocabulary.size) return 0;
  const dot = [...vocabulary].filter((word) => leftWords.includes(word) && rightWords.includes(word)).length;
  return (dot / Math.sqrt(leftWords.length * rightWords.length || 1)) * 100;
}

export function rankCandidates(candidates: Candidate[], job: string, mustHaves: string[]): RankedCandidate[] {
  const required = [...new Set([...recogniseSkills(job), ...mustHaves])];
  const jobWords = meaningfulWords(job);
  return candidates.map((candidate) => {
    const matchedSkills = required.filter((skill) => textShowsSkill(candidate.text, skill));
    const missingSkills = required.filter((skill) => !textShowsSkill(candidate.text, skill));
    const missingMustHaves = mustHaves.filter((skill) => !textShowsSkill(candidate.text, skill));
    const skillCoverage = required.length ? (matchedSkills.length / required.length) * 100 : 0;
    const candidateWords = meaningfulWords(candidate.text);
    const keywordCoverage = jobWords.size ? ([...jobWords].filter((word) => candidateWords.has(word)).length / jobWords.size) * 100 : 0;
    const textSimilarity = cosineSimilarity(candidate.text, job);
    const formula: RankedCandidate["formula"] = required.length ? "skills" : "fallback";
    const weights = formula === "skills" ? SCORE_WEIGHTS : FALLBACK_WEIGHTS;
    const points = {
      skills: Number((weights.skills * skillCoverage).toFixed(1)),
      keywords: Number((weights.keywords * keywordCoverage).toFixed(1)),
      text: Number((weights.text * textSimilarity).toFixed(1)),
    };
    const score = weights.skills * skillCoverage + weights.keywords * keywordCoverage + weights.text * textSimilarity;
    return { ...candidate, score: Number(score.toFixed(1)), skillCoverage: Number(skillCoverage.toFixed(1)), keywordCoverage: Number(keywordCoverage.toFixed(1)), textSimilarity: Number(textSimilarity.toFixed(1)), matchedSkills, missingSkills, missingMustHaves, meetsMustHaves: missingMustHaves.length === 0, points, formula };
  }).sort((a, b) => Number(b.meetsMustHaves) - Number(a.meetsMustHaves) || b.score - a.score);
}

// Fictional demo resumes (no real people). Written as short, realistic resumes so the
// evidence panel has sentences to show, including one negated skill.
export const demoCandidates: Candidate[] = [
  {
    id: "Candidate 0001",
    role: "Data Analyst",
    text: "Data analyst with three years of experience in retail reporting.\nData Analyst, Example Retail Co (fictional), Mar 2023 – Present\nBuilt automated Python and pandas pipelines that cut weekly reporting time by 60%.\nWrote PostgreSQL queries for sales and stock analysis.\nDesigned Tableau dashboards used by regional managers.\nRan A/B tests on promotional emails and reported results with statistical significance.\nPresented insights to stakeholders every month.\nEmployee of the Quarter award for the automated reporting project (Q3 2024).\nData Analyst Intern, Example Bank (fictional), summer 2022.",
  },
  {
    id: "Candidate 0002",
    role: "Business Intelligence Analyst",
    text: "Business intelligence analyst in financial services.\nBI Analyst, Example Bank (fictional), 2018 – 2024\nMaintained advanced Excel models and Power BI dashboards for the finance team.\nWrote SQL views to feed monthly KPI reports.\nCoordinated report releases using project management practices.\nNot familiar with Python yet, but comfortable learning new tools.\nMicrosoft Certified: Power BI Data Analyst Associate.",
  },
  {
    id: "Candidate 0003",
    role: "Python Developer",
    text: "Python developer building REST APIs with Django.\nSoftware Developer, Example Start-up (fictional), Feb 2025 – Present\nContainerised services with Docker and deployed them to AWS.\nUsed Git pull requests and code review on every change.\nBuilt a small machine learning pipeline to tag support tickets.\nHackerRank 5-star Python badge.\nFinalist, Example City hackathon 2024, with a ticket-routing prototype.",
  },
  {
    id: "Candidate 0004",
    role: "Graduate Analyst",
    text: "Recent statistics graduate.\nBachelor of Science (Statistics), Example University (fictional), 2022 – 2025\nCompleted SQL projects analysing public transport data.\nPrepared Excel reports for a university society and presented findings.\nNo Python experience yet; currently taking an online course.\nDean's List, 2024.\nData Analytics Intern, Example Council (fictional), summer 2024.",
  },
  {
    id: "Candidate 0005",
    role: "Data Engineer",
    text: "Data engineer skilled in Python and SQL.\nData Engineer, Example Logistics (fictional), Jan 2016 – Jun 2019\nSenior Data Engineer, Example Health (fictional), Jul 2019 – Present\nBuilt batch pipelines on AWS with Docker and NumPy for data quality checks.\nDocumented data models and monitored pipeline health.\nRecognised by leadership for cutting pipeline costs by 30%.\nAWS Certified Data Engineer – Associate.",
  },
];
