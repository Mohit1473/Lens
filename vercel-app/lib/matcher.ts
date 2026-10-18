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
};

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

function affirmed(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.replace("g", "") + "g";
  const matcher = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(matcher)) {
    const before = text.slice(0, match.index ?? 0);
    const boundaries = [...before.matchAll(boundary)];
    const start = boundaries.length ? (boundaries.at(-1)?.index ?? 0) + (boundaries.at(-1)?.[0].length ?? 0) : 0;
    if (!negation.test(text.slice(start, match.index))) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textShowsSkill(text: string, skill: string): boolean {
  const cataloguePattern = patterns[skill];
  if (cataloguePattern) return affirmed(text, cataloguePattern);
  return new RegExp(`\\b${escapeRegExp(skill)}\\b`, "i").test(text);
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
    const score = required.length
      ? 0.65 * skillCoverage + 0.2 * keywordCoverage + 0.15 * textSimilarity
      : 0.75 * keywordCoverage + 0.25 * textSimilarity;
    return { ...candidate, score: Number(score.toFixed(1)), skillCoverage: Number(skillCoverage.toFixed(1)), keywordCoverage: Number(keywordCoverage.toFixed(1)), textSimilarity: Number(textSimilarity.toFixed(1)), matchedSkills, missingSkills, missingMustHaves, meetsMustHaves: missingMustHaves.length === 0 };
  }).sort((a, b) => Number(b.meetsMustHaves) - Number(a.meetsMustHaves) || b.score - a.score);
}

export const demoCandidates: Candidate[] = [
  { id: "Candidate 0001", role: "Data Analyst", text: "Data analyst with Python, SQL, Tableau dashboards, statistics, A/B tests, pandas and stakeholder reporting." },
  { id: "Candidate 0002", role: "Business Intelligence Analyst", text: "Business intelligence analyst using Excel, Power BI, SQL, data visualization and project management." },
  { id: "Candidate 0003", role: "Python Developer", text: "Python developer with Django, REST APIs, Docker, AWS, Git and machine learning pipelines." },
  { id: "Candidate 0004", role: "Graduate Analyst", text: "Graduate analyst with Excel reporting, statistics coursework, SQL projects and communication skills." },
  { id: "Candidate 0005", role: "Data Engineer", text: "Data engineer skilled in Python, SQL, Docker, AWS, NumPy and data pipeline development." },
];
