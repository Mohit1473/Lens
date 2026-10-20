// Highlights: awards, competition results, certifications and internships pulled out of a
// resume so a recruiter can see what makes a candidate stand out. Shown for review only;
// highlights are never added to the match score, and employers are shown exactly as written
// rather than ranked by reputation.

export type HighlightCategory = "award" | "competition" | "certification" | "internship";

export type Highlight = {
  category: HighlightCategory;
  text: string; // the resume line or sentence, tidied for display
};

export const HIGHLIGHT_LABELS: Record<HighlightCategory, { label: string; icon: string }> = {
  award: { label: "Awards & recognition", icon: "🏆" },
  competition: { label: "Competitions & coding", icon: "💻" },
  certification: { label: "Certifications", icon: "📜" },
  internship: { label: "Internships", icon: "🎓" },
};

// Order matters: a line is filed under the first category it matches.
const PATTERNS: Array<[HighlightCategory, RegExp]> = [
  ["competition", /\b(hackerrank|leetcode|kaggle|codechef|codeforces|topcoder|hackathons?|datathons?|coding\s+(?:competition|contest|challenge)|competitive\s+programming|olympiad)\b/i],
  ["award", /\b(awards?|awarded|winner|won|recipient|honou?rs?|honou?red|medal(?:list)?|prize|scholarship|dean['’]?s\s+list|employee\s+of\s+the\s+(?:month|quarter|year)|best\s+(?:employee|performer|project|paper)|top\s+performer|recogni[sz]ed\s+(?:by|for|as)|(?:received|earned|won)\s+(?:a\s+)?recognition|recognition\s+(?:for|from|award)|commended|(?:letter|certificate)\s+of\s+appreciation|finalist|runner[-\s]?up|(?:1st|2nd|3rd|first|second|third)\s+place|ranked\s+(?:#?\d|top))\b/i],
  ["certification", /\b(certified|certification|certificate|accredited|PMP|CFA|CPA|scrum\s+master|PRINCE2|ITIL)\b/i],
  ["internship", /\b(intern|internship|interned|summer\s+analyst|co-?op\s+placement|work\s+placement)\b/i],
];

// Lines that only say what the candidate lacks or plans ("no certifications yet",
// "willing to learn", "planning to sit the AWS certificate") are not achievements.
const NOT_AN_ACHIEVEMENT = /^\s*(?:no|not|never|without|none|n\/a)\b|\b(?:willing|planning|plan|hoping|hope|aim(?:ing)?|want(?:ing)?)\s+to\b|\b(?:currently\s+)?(?:studying|preparing)\s+for\b/i;

function pieces(text: string): string[] {
  // Split into lines, then sentences, keeping bullets and headings apart.
  return text
    .split(/\n|•|(?<=[.!?])\s+(?=[A-Z])/)
    .map((piece) => piece.replace(/^[\s\-*–•]+/, "").replace(/\s+/g, " ").trim())
    .filter((piece) => piece.length >= 6 && piece.length <= 300);
}

/** Highlights found in a resume, grouped in category order, without duplicates. */
export function findHighlights(text: string): Highlight[] {
  const seen = new Set<string>();
  const found: Highlight[] = [];
  for (const piece of pieces(text)) {
    if (NOT_AN_ACHIEVEMENT.test(piece)) continue;
    const match = PATTERNS.find(([, pattern]) => pattern.test(piece));
    if (!match) continue;
    // Skip bare section headings such as "Certifications" or "Awards".
    if (piece.split(/\s+/).length < 3 && /^[A-Za-z &]+:?$/.test(piece)) continue;
    const key = piece.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ category: match[0], text: piece.length > 160 ? `${piece.slice(0, 157)}…` : piece });
  }
  const order: HighlightCategory[] = ["award", "competition", "certification", "internship"];
  return found.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
}
