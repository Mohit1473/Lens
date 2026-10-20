"use client";

import { ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Candidate, Evidence, RankedCandidate, demoCandidates, findEvidence, rankCandidates, recogniseSkills } from "../lib/matcher";
import { extractPdfText } from "../lib/pdf";
import { BLANK_ROLE, DEFAULT_TEMPLATE, EDITED_ROLE, EMPLOYMENT_TYPES, EXPERIENCE_OPTIONS, EmploymentType, ROLE_TEMPLATES, SENIORITIES, SENIORITY_MIN_YEARS, SavedRole, Seniority, findTemplate, isSavedRoleId } from "../lib/templates";
import { ExperienceEstimate, ExperienceStatus, estimateExperience, experienceStatus, formatYears, requiredYearsFromJob } from "../lib/experience";
import { inferRole } from "../lib/roleInfer";
import { HIGHLIGHT_LABELS, Highlight, HighlightCategory, findHighlights } from "../lib/highlights";

type Mode = "manual" | "automated";
type StepState = "done" | "active" | "pending";

const STORAGE_KEY = "lens-form-v1";
const ROLES_KEY = "lens-saved-roles-v1";
const MIN_JOB_CHARS = 40; // a couple of sentences, enough to detect skills and keywords
const SHORTLIST_SIZES = [3, 5, 8];
const STEPS = [
  { id: "role", label: "Role brief" },
  { id: "skills", label: "Must-haves" },
  { id: "candidates", label: "Candidates" },
  { id: "shortlist", label: "Shortlist" },
] as const;
// Automated-run phases, in order. Each maps onto one of the four visible steps.
const RUN_PHASES = [
  { step: 0, text: "Choosing the role template…" },
  { step: 0, text: "Writing the job description…" },
  { step: 1, text: "Selecting must-have skills…" },
  { step: 2, text: "Loading candidate resumes…" },
  { step: 3, text: "Ranking candidates and building the shortlist…" },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const EXPERIENCE_STATUS_TEXT: Record<ExperienceStatus, string> = {
  meets: "Meets requirement",
  below: "Below requirement - review",
  unclear: "Unclear - review",
  "not-required": "No requirement set",
};

function exportCsv(rows: RankedCandidate[], label: (candidate: RankedCandidate) => string, experience: (candidate: RankedCandidate) => { estimate: ExperienceEstimate; status: ExperienceStatus }, highlights: (candidate: RankedCandidate) => Highlight[]) {
  const header = ["Rank", "Candidate", "Role", "Match score", "Matched skills", "Missing skills", "Must-have status", "Estimated experience (years)", "Experience status", "Highlights"];
  const lines = rows.map((row, index) => {
    const { estimate, status } = experience(row);
    return [index + 1, label(row), row.role ?? "", row.score, row.matchedSkills.join("; "), row.missingSkills.join("; "), row.meetsMustHaves ? "All must-haves met" : "Review required", estimate.years ?? "unclear", EXPERIENCE_STATUS_TEXT[status], highlights(row).map((item) => `${HIGHLIGHT_LABELS[item.category].label}: ${item.text}`).join(" | ")];
  });
  const csv = [header, ...lines].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "resume-match-results.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Give uploaded files unique ids (their file names), so blind screening has something to hide. */
function uniqueIds(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
}

/** Circular gauge for a 0–100 match score. */
function ScoreRing({ score, size = 84 }: { score: number; size?: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.max(0, Math.min(score, 100)) / 100) * circumference;
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 84 84" role="img" aria-label={`Match score ${score} out of 100`}>
      <circle cx="42" cy="42" r={radius} className="ring-track" />
      <circle cx="42" cy="42" r={radius} className="ring-value" strokeDasharray={`${filled} ${circumference}`} transform="rotate(-90 42 42)" />
      <text x="42" y="44" textAnchor="middle" className="ring-score">{score}</text>
      <text x="42" y="58" textAnchor="middle" className="ring-out">/100</text>
    </svg>
  );
}

/** Stacked bar showing how many points each score component added (out of 100). */
function Breakdown({ candidate }: { candidate: RankedCandidate }) {
  const parts = [
    { name: "Skills", value: candidate.points.skills, className: "seg-skills" },
    { name: "Keywords", value: candidate.points.keywords, className: "seg-keywords" },
    { name: "Text", value: candidate.points.text, className: "seg-text" },
  ].filter((part) => candidate.formula === "skills" || part.name !== "Skills");
  return (
    <div className="breakdown">
      <div className="stack" role="img" aria-label={parts.map((part) => `${part.name} ${part.value} points`).join(", ")}>
        {parts.map((part) => <i key={part.name} className={part.className} style={{ width: `${part.value}%` }} title={`${part.name}: ${part.value} points`} />)}
      </div>
      <div className="legend">
        {parts.map((part) => <span key={part.name}><b className={part.className} />{part.name} {part.value}</span>)}
      </div>
    </div>
  );
}

/** Resume text with counted skill mentions highlighted and negated ones struck through. */
function highlightResume(text: string, evidence: Evidence[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const item of evidence) {
    if (item.start < cursor) continue; // overlapping span already highlighted
    if (item.start > cursor) nodes.push(text.slice(cursor, item.start));
    nodes.push(
      <mark key={`${item.start}-${item.skill}`} className={item.negated ? "neg" : "hit"} title={item.negated ? `${item.skill}: mentioned but negated, so not counted` : `${item.skill}: counted`}>
        {text.slice(item.start, item.end)}
      </mark>,
    );
    cursor = item.end;
  }
  nodes.push(text.slice(cursor));
  return nodes;
}

export default function Home() {
  // --- Form state, prefilled with sensible defaults -------------------------
  const [mode, setMode] = useState<Mode>("manual");
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE.id);
  const [title, setTitle] = useState(DEFAULT_TEMPLATE.title);
  const [seniority, setSeniority] = useState<Seniority>(DEFAULT_TEMPLATE.seniority);
  const [location, setLocation] = useState(DEFAULT_TEMPLATE.location);
  const [job, setJob] = useState(DEFAULT_TEMPLATE.description);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(recogniseSkills(DEFAULT_TEMPLATE.description));
  const [additionalSkills, setAdditionalSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>(demoCandidates);
  const [usingDemoCandidates, setUsingDemoCandidates] = useState(true);
  const [strictMustHaveFilter, setStrictMustHaveFilter] = useState(true);
  const [blind, setBlind] = useState(true);
  const [shortlistSize, setShortlistSize] = useState(5);
  const [minYears, setMinYears] = useState<number | null>(requiredYearsFromJob(DEFAULT_TEMPLATE.description) ?? SENIORITY_MIN_YEARS[DEFAULT_TEMPLATE.seniority]);
  const [experienceFilter, setExperienceFilter] = useState(false);
  const [restored, setRestored] = useState(false);
  const [employmentType, setEmploymentType] = useState<EmploymentType>("Full-time");
  const [savedRoles, setSavedRoles] = useState<SavedRole[]>([]);
  const [roleNote, setRoleNote] = useState("");
  const [ownRun, setOwnRun] = useState(false); // Auto-run is using the recruiter's own role text
  const titleRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<HTMLTextAreaElement>(null);
  // In "Write my own role", fields the recruiter has changed by hand; the rest follow the job description.
  const [touched, setTouched] = useState<string[]>([]);

  // --- Automated run state ---------------------------------------------------
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(-1); // index into RUN_PHASES, -1 when idle
  const [runMessage, setRunMessage] = useState("");
  const [revealed, setRevealed] = useState(true); // results hidden while an automated run builds up
  const [evidenceId, setEvidenceId] = useState<string | null>(null); // candidate shown in the evidence panel
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const runId = useRef(0);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!evidenceId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setEvidenceId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [evidenceId]);

  // --- Restore the last-used form (per browser) -------------------------------
  useEffect(() => {
    try {
      const roles = JSON.parse(window.localStorage.getItem(ROLES_KEY) ?? "[]");
      if (Array.isArray(roles)) setSavedRoles(roles.filter((role) => role && typeof role.id === "string" && typeof role.title === "string" && typeof role.description === "string"));
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved && typeof saved === "object") {
        if (typeof saved.templateId === "string") setTemplateId(saved.templateId);
        if (typeof saved.title === "string") setTitle(saved.title);
        if (SENIORITIES.includes(saved.seniority)) setSeniority(saved.seniority);
        if (typeof saved.location === "string") setLocation(saved.location);
        if (typeof saved.job === "string") setJob(saved.job);
        if (Array.isArray(saved.selectedSkills)) setSelectedSkills(saved.selectedSkills.filter((s: unknown) => typeof s === "string"));
        if (Array.isArray(saved.additionalSkills)) setAdditionalSkills(saved.additionalSkills.filter((s: unknown) => typeof s === "string"));
        if (typeof saved.strict === "boolean") setStrictMustHaveFilter(saved.strict);
        if (typeof saved.blind === "boolean") setBlind(saved.blind);
        if (SHORTLIST_SIZES.includes(saved.shortlistSize)) setShortlistSize(saved.shortlistSize);
        if (EXPERIENCE_OPTIONS.includes(saved.minYears)) setMinYears(saved.minYears);
        if (typeof saved.experienceFilter === "boolean") setExperienceFilter(saved.experienceFilter);
        if (saved.mode === "manual" || saved.mode === "automated") setMode(saved.mode);
        if (Array.isArray(saved.touched)) setTouched(saved.touched.filter((field: unknown) => typeof field === "string"));
        if (EMPLOYMENT_TYPES.includes(saved.employmentType)) setEmploymentType(saved.employmentType);
        setRestored(true);
      }
    } catch {
      /* storage unavailable: keep defaults */
    }
  }, []);

  useEffect(() => {
    if (running) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ templateId, title, seniority, location, job, selectedSkills, additionalSkills, strict: strictMustHaveFilter, blind, shortlistSize, mode, minYears, experienceFilter, employmentType, touched }));
    } catch {
      /* storage unavailable: nothing to save */
    }
  }, [templateId, title, seniority, location, job, selectedSkills, additionalSkills, strictMustHaveFilter, blind, shortlistSize, mode, minYears, experienceFilter, employmentType, touched, running]);

  // Saved roles live in this browser only, under their own key.
  const rolesLoaded = useRef(false);
  useEffect(() => {
    if (!rolesLoaded.current) { rolesLoaded.current = true; return; } // skip the first render, before restore
    try {
      window.localStorage.setItem(ROLES_KEY, JSON.stringify(savedRoles));
    } catch {
      /* storage unavailable */
    }
  }, [savedRoles]);

  // --- Ranking ----------------------------------------------------------------
  const detected = useMemo(() => recogniseSkills(job), [job]);
  const inferred = useMemo(() => inferRole(job), [job]);
  const autoFilling = templateId === BLANK_ROLE;
  const mustHaves = useMemo(() => [...new Set([...selectedSkills, ...additionalSkills])], [selectedSkills, additionalSkills]);
  const allRanked = useMemo(() => rankCandidates(candidates, job, mustHaves), [candidates, job, mustHaves]);
  const rankOf = useMemo(() => new Map(allRanked.map((candidate, index) => [candidate.id, index + 1])), [allRanked]);
  // Experience is estimated per resume and compared with the role minimum. It is never scored.
  const experienceOf = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, estimateExperience(candidate.text)])), [candidates]);
  const experience = (candidate: RankedCandidate) => {
    const estimate = experienceOf.get(candidate.id) ?? { years: null, method: "none" as const, evidence: [] };
    return { estimate, status: experienceStatus(estimate, minYears) };
  };
  const jobYears = useMemo(() => requiredYearsFromJob(job), [job]);
  // Awards, competitions, certifications and internships: shown for review, never scored.
  const highlightMap = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, findHighlights(candidate.text)])), [candidates]);
  const highlightsOf = (candidate: RankedCandidate) => highlightMap.get(candidate.id) ?? [];
  const strict = strictMustHaveFilter && mustHaves.length > 0;
  const experienceFilterOn = experienceFilter && minYears !== null;
  // Candidates with unclear experience stay visible (flagged) rather than being filtered out.
  const passes = (candidate: RankedCandidate) =>
    (!strict || candidate.meetsMustHaves) && (!experienceFilterOn || experience(candidate).status !== "below");
  const ranked = allRanked.filter(passes);
  const shortlist = ranked.slice(0, shortlistSize);
  const alternatives = strict || experienceFilterOn ? allRanked.filter((candidate) => !passes(candidate)).slice(0, 3) : [];
  const meetsExperience = allRanked.filter((candidate) => experience(candidate).status === "meets").length;
  // One label per candidate everywhere (cards, table, CSV), based on overall rank.
  const label = (candidate: RankedCandidate) =>
    blind ? `Candidate ${String(rankOf.get(candidate.id) ?? 0).padStart(4, "0")}` : candidate.id;

  // --- Step tracker -----------------------------------------------------------
  const jobReady = title.trim().length > 0 && job.trim().length >= MIN_JOB_CHARS;
  const stepDone = [
    jobReady,
    mustHaves.length > 0,
    candidates.length > 0,
    revealed && allRanked.length > 0,
  ];
  const stepState = (index: number): StepState => {
    if (running) {
      const activeStep = RUN_PHASES[phase]?.step ?? -1;
      return index < activeStep ? "done" : index === activeStep ? "active" : "pending";
    }
    if (stepDone[index]) return "done";
    return stepDone.slice(0, index).every(Boolean) ? "active" : "pending";
  };
  const highlight = (stepIndex: number) => (running && RUN_PHASES[phase]?.step === stepIndex ? " flash" : "");

  // --- Manual actions ---------------------------------------------------------
  function updateJob(value: string) {
    setJob(value);
    setSelectedSkills(recogniseSkills(value));
    const years = requiredYearsFromJob(value);
    if (years !== null) setMinYears(years); // "3+ years of experience" in the text prefills the field
  }

  function updateSeniority(value: Seniority) {
    setSeniority(value);
    // Only fall back to the seniority default when the job text does not state a number of years.
    if (requiredYearsFromJob(job) === null) setMinYears(SENIORITY_MIN_YEARS[value]);
  }

  function applyTemplate(id: string) {
    setRoleNote("");
    setTemplateId(id);
    if (id === EDITED_ROLE) return; // keep whatever the recruiter typed
    if (id === BLANK_ROLE) {
      // "Write my own role": clear the brief so the recruiter starts from scratch.
      setTitle("");
      setSeniority("Mid-level");
      setLocation("");
      setEmploymentType("Full-time");
      setJob("");
      setSelectedSkills([]);
      setAdditionalSkills([]);
      setMinYears(null);
      setTouched([]);
      setTimeout(() => jobRef.current?.focus(), 0);
      return;
    }
    const saved = savedRoles.find((role) => role.id === id);
    if (saved) {
      setTitle(saved.title);
      setSeniority(saved.seniority);
      setLocation(saved.location);
      setEmploymentType(saved.employmentType);
      setJob(saved.description);
      setSelectedSkills(recogniseSkills(saved.description));
      setAdditionalSkills(saved.extraMustHaves);
      setMinYears(saved.minYears);
      return;
    }
    const template = findTemplate(id);
    if (!template) return;
    setTitle(template.title);
    setSeniority(template.seniority);
    setLocation(template.location);
    setEmploymentType("Full-time");
    updateJob(template.description);
    setMinYears(requiredYearsFromJob(template.description) ?? SENIORITY_MIN_YEARS[template.seniority]);
    setAdditionalSkills([]);
  }

  /**
   * Any edit to a ready-made or saved role turns it into the recruiter's own version.
   * In "Write my own role", a field changed by hand stops following the job description.
   */
  function markEdited(field?: string) {
    if (templateId === BLANK_ROLE) {
      if (field && !touched.includes(field)) setTouched((list) => [...list, field]);
    } else if (templateId !== EDITED_ROLE) setTemplateId(EDITED_ROLE);
    setRoleNote("");
  }

  /** Job description edits. In "Write my own role" the other fields are filled from it. */
  function onJobInput(value: string) {
    if (templateId !== BLANK_ROLE) {
      updateJob(value);
      markEdited();
      return;
    }
    setJob(value);
    setSelectedSkills(recogniseSkills(value));
    const guess = inferRole(value);
    const free = (field: string) => !touched.includes(field);
    if (free("title")) setTitle(guess.title ?? "");
    if (free("employmentType")) setEmploymentType(guess.employmentType ?? "Full-time");
    if (free("location")) setLocation(guess.location ?? "");
    if (free("seniority")) setSeniority(guess.seniority ?? "Mid-level");
    if (free("minYears")) setMinYears(guess.minYears ?? (guess.seniority ? SENIORITY_MIN_YEARS[guess.seniority] : null));
  }

  /** "auto" tag for a field filled from the job description. */
  function autoTag(field: keyof typeof inferred, filled: boolean) {
    if (!autoFilling || touched.includes(field) || !filled) return null;
    return <em className="auto" title="Filled from the job description. Change it and Lens leaves it alone.">auto</em>;
  }

  function saveRole() {
    if (!jobReady) return;
    const existing = savedRoles.find((role) => role.title.trim().toLowerCase() === title.trim().toLowerCase());
    const role: SavedRole = {
      id: existing?.id ?? `mine-${Date.now()}`,
      title: title.trim(),
      seniority,
      location: location.trim(),
      description: job.trim(),
      employmentType,
      minYears,
      extraMustHaves: additionalSkills,
      savedAt: new Date().toISOString(),
    };
    setSavedRoles((list) => (existing ? list.map((item) => (item.id === role.id ? role : item)) : [...list, role]));
    setTemplateId(role.id);
    setRoleNote(existing ? `Updated “${role.title}” in your saved roles.` : `Saved “${role.title}”. Pick it any time from Role template.`);
  }

  function deleteRole() {
    if (!isSavedRoleId(templateId)) return;
    const removed = savedRoles.find((role) => role.id === templateId);
    setSavedRoles((list) => list.filter((role) => role.id !== templateId));
    setTemplateId(EDITED_ROLE);
    setRoleNote(`Removed “${removed?.title ?? "role"}” from your saved roles. The form keeps its text.`);
  }

  function addMustHaveSkill() {
    const skill = newSkill.trim();
    if (!skill || mustHaves.some((item) => item.toLowerCase() === skill.toLowerCase())) return;
    setAdditionalSkills((current) => [...current, skill]);
    setNewSkill("");
  }

  async function addResumes(event: ChangeEvent<HTMLInputElement>) {
    // Windows sometimes reports an empty MIME type for .txt files, so check the extension too.
    const files = Array.from(event.target.files ?? []).filter((file) => /\.(pdf|txt)$/i.test(file.name) || file.type === "text/plain" || file.type === "application/pdf");
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setUploadNote("");
    const ids = uniqueIds(files.map((file) => file.name.replace(/\.(pdf|txt)$/i, "")));
    const loaded: Candidate[] = [];
    const skipped: string[] = [];
    for (const [index, file] of files.entries()) {
      try {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const text = (isPdf ? await extractPdfText(file) : await file.text()).trim();
        if (text.length < 20) skipped.push(`${file.name} (no readable text — it may be a scanned image)`);
        else loaded.push({ id: ids[index], text, role: isPdf ? "Uploaded PDF" : "Uploaded text" });
      } catch {
        skipped.push(`${file.name} (could not be read)`);
      }
    }
    setUploading(false);
    if (loaded.length) {
      setCandidates(loaded);
      setUsingDemoCandidates(false);
    }
    setUploadNote(skipped.length ? `Skipped ${skipped.length}: ${skipped.join("; ")}` : "");
  }

  function resetForm() {
    stopRun();
    applyTemplate(DEFAULT_TEMPLATE.id);
    setCandidates(demoCandidates);
    setUsingDemoCandidates(true);
    setStrictMustHaveFilter(true);
    setBlind(true);
    setShortlistSize(5);
    setExperienceFilter(false);
    setRoleNote("");
    setTouched([]);
    setRestored(false);
    setRevealed(true);
  }

  // --- Automated run ------------------------------------------------------------
  function stopRun() {
    runId.current += 1;
    setOwnRun(false);
    setRunning(false);
    setPhase(-1);
    setRevealed(true);
  }

  async function autoRun() {
    const id = ++runId.current;
    const alive = () => runId.current === id;
    const template = findTemplate(templateId);
    // A blank, edited or saved role is the recruiter's own: Auto-run keeps their text.
    const own = !template;
    if (own && !jobReady) {
      setMode("automated");
      setRunMessage("Auto-run needs a job title and a job description of a couple of sentences. Fill them in, or pick a ready-made role from Role template.");
      titleRef.current?.focus();
      return;
    }
    const started = performance.now();
    setMode("automated");
    setRunning(true);
    setOwnRun(own);
    setRevealed(false);
    setRunMessage("");
    let text = job;

    if (template) {
      // 1. Role template
      setPhase(0);
      setTemplateId(template.id);
      setTitle(template.title);
      setSeniority(template.seniority);
      setLocation(template.location);
      setEmploymentType("Full-time");
      setSelectedSkills([]);
      setAdditionalSkills([]);
      setJob("");
      await sleep(500);
      if (!alive()) return;

      // 2. Type the job description
      setPhase(1);
      text = template.description;
      for (let end = 6; end < text.length + 6; end += 6) {
        setJob(text.slice(0, end));
        await sleep(14);
        if (!alive()) return;
      }
      setMinYears(requiredYearsFromJob(text) ?? SENIORITY_MIN_YEARS[template.seniority]);
    } else {
      // 1–2. Use the recruiter's own brief as written
      setPhase(0);
      await sleep(350);
      if (!alive()) return;
      setPhase(1);
      setSelectedSkills([]);
      await sleep(450);
      if (!alive()) return;
      const stated = requiredYearsFromJob(text);
      if (stated !== null) setMinYears(stated);
    }

    // 3. Tick must-haves one by one
    setPhase(2);
    const skills = recogniseSkills(text);
    for (const skill of skills) {
      setSelectedSkills((current) => [...current, skill]);
      await sleep(260);
      if (!alive()) return;
    }

    // 4. Candidates: keep uploads if the recruiter added some, otherwise use the demo set
    setPhase(3);
    if (usingDemoCandidates || !candidates.length) {
      setCandidates(demoCandidates);
      setUsingDemoCandidates(true);
    }
    await sleep(500);
    if (!alive()) return;

    // 5. Rank and reveal
    setPhase(4);
    await sleep(700);
    if (!alive()) return;
    setRevealed(true);
    setRunning(false);
    setPhase(-1);
    setOwnRun(false);
    setRunMessage(`Done in ${((performance.now() - started) / 1000).toFixed(1)} s${own ? " using your own role brief" : ""}. Every field stays editable, so switch to Manual to fine-tune.`);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --- Rendering ----------------------------------------------------------------
  function experienceBadge(candidate: RankedCandidate) {
    const { estimate, status } = experience(candidate);
    const years = formatYears(estimate.years);
    const text = {
      meets: `✓ ${years} experience · meets ${minYears}+`,
      below: `⚠ ${years} experience · below ${minYears}+`,
      unclear: `? Experience unclear · role asks ${minYears}+`,
      "not-required": estimate.years === null ? "Experience not stated" : `${years} experience`,
    }[status];
    return <p className={`exp exp-${status}`}>{text}</p>;
  }

  function highlightChips(candidate: RankedCandidate) {
    const items = highlightsOf(candidate);
    if (!items.length) return null;
    const shown = items.slice(0, 2);
    return (
      <div className="highlights">
        <b>Highlights</b>
        {shown.map((item) => (
          <span key={item.text} className={`hl hl-${item.category}`} title={`${HIGHLIGHT_LABELS[item.category].label}: ${item.text}`}>
            <i aria-hidden="true">{HIGHLIGHT_LABELS[item.category].icon}</i>{item.text.length > 46 ? `${item.text.slice(0, 44).trim()}…` : item.text}
          </span>
        ))}
        {items.length > shown.length && <button type="button" className="hl-more" onClick={() => setEvidenceId(candidate.id)}>+{items.length - shown.length} more</button>}
      </div>
    );
  }

  function candidateCard(candidate: RankedCandidate, reviewOnly = false) {
    return (
      <article className={reviewOnly ? "review-card" : ""} key={candidate.id}>
        <div className="card-head">
          <div>
            <div className="rank">#{rankOf.get(candidate.id)}</div>
            <h3>{label(candidate)}</h3>
            <p>{candidate.role ?? "Candidate"}</p>
          </div>
          <ScoreRing score={candidate.score} />
        </div>
        <Breakdown candidate={candidate} />
        <p className={candidate.meetsMustHaves ? "good" : "warn"}>{candidate.meetsMustHaves ? "✓ All must-haves met" : "⚠ Review required"}</p>
        {experienceBadge(candidate)}
        {highlightChips(candidate)}
        <div className="skills"><b>Matched</b>{candidate.matchedSkills.length ? candidate.matchedSkills.map((skill) => <span key={skill}>{skill}</span>) : <em>None shown</em>}</div>
        <div className="skills missing"><b>Missing</b>{candidate.missingMustHaves.length ? candidate.missingMustHaves.map((skill) => <span key={skill}>{skill}</span>) : <em>None</em>}</div>
        <button type="button" className="evidence-btn" onClick={() => setEvidenceId(candidate.id)}>View evidence →</button>
      </article>
    );
  }

  const requiredSkills = [...new Set([...detected, ...mustHaves])];
  const evidenceCandidate = evidenceId ? allRanked.find((candidate) => candidate.id === evidenceId) : undefined;
  const evidence = evidenceCandidate ? findEvidence(evidenceCandidate.text, requiredSkills) : [];

  const locked = running; // fields are read-only while the automated run is filling them
  const phaseText = (index: number) =>
    ownRun && index === 0 ? "Using your role brief…" : ownRun && index === 1 ? "Reading your job description…" : RUN_PHASES[index]?.text;
  const jobBlock = (
    <>
      <label>Job description <em className="req">required</em>
        <textarea ref={jobRef} className={autoFilling ? "lead-input" : ""} value={job} readOnly={locked} onChange={(event) => onJobInput(event.target.value)} placeholder={autoFilling
          ? "Paste or write the job description, for example:\n\nWe are seeking a data analyst with 2+ years of experience in Python, SQL, data visualization, statistics, and stakeholder communication. Full-time, hybrid, based in Sydney."
          : "Describe the role in a few sentences, for example:\n• Must-have skills (e.g. SQL, Excel, Tableau)\n• Years of experience (e.g. 3+ years of experience)\n• Main responsibilities and what success looks like"} />
      </label>
      <p className={`helper field-hint${job.trim().length > 0 && job.trim().length < MIN_JOB_CHARS ? " warn-text" : ""}`}>
        {job.trim().length >= MIN_JOB_CHARS
          ? `${job.trim().length} characters · ${detected.length} skill${detected.length === 1 ? "" : "s"} detected${jobYears !== null ? ` · ${jobYears}+ years detected` : ""}`
          : `Write at least a couple of sentences (${job.trim().length}/${MIN_JOB_CHARS} characters) so Lens can detect skills and keywords.`}
      </p>
      {autoFilling && job.trim().length >= MIN_JOB_CHARS && !title.trim() && (
        <p className="helper field-hint warn-text">Lens could not find a job title in the description. Type it in below, or start with “We are hiring a …”.</p>
      )}
    </>
  );
  const roleHint =
    templateId === BLANK_ROLE
      ? "Write or paste the job description first. Lens fills the job title, seniority, experience, employment type, location and must-have skills from it. Anything you change by hand stays as you set it."
      : templateId === EDITED_ROLE
        ? "Your own version. Save it to reuse it later."
        : isSavedRoleId(templateId)
          ? "One of your saved roles."
          : "Ready-made role. Edit anything, or choose “Write my own role” to start blank."

  return (
    <main>
      <header className="topbar">
        <div>
          <h1>Lens</h1>
          <p className="tagline">See who fits — and exactly why.</p>
          <p className="intro">Drop in a role and a stack of resumes. Lens surfaces the strongest matches and traces every score back to the skills it found, so the final call stays yours. Work through it step by step, or let Auto-run handle it in one click.</p>
        </div>
        <div className="controls">
          <div className="mode-switch" role="radiogroup" aria-label="Mode">
            {(["manual", "automated"] as Mode[]).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} className={mode === value ? "on" : ""} disabled={running} onClick={() => setMode(value)}>
                {value === "manual" ? "Manual" : "Automated"}
              </button>
            ))}
          </div>
          {running
            ? <button type="button" className="run stop" onClick={stopRun}>■ Stop</button>
            : <button type="button" className="run" onClick={autoRun}>⚡ Auto-run all steps</button>}
        </div>
      </header>

      <ol className="stepper" aria-label="Progress">
        {STEPS.map((step, index) => (
          <li key={step.id} className={stepState(index)}>
            <span className="dot">{stepState(index) === "done" ? "✓" : index + 1}</span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>

      <p className="run-status" aria-live="polite">
        {running ? phaseText(phase) : runMessage || (mode === "automated"
          ? "Automated mode: pick a ready-made role or write your own, then press Auto-run. Ready-made roles are typed in for you; your own brief is used exactly as written. Lens then ticks must-haves, loads candidates and ranks them."
          : restored ? "Your last entries were restored. Use Reset to go back to the defaults." : "Manual mode: every field is prefilled with a sensible default — edit anything you like.")}
      </p>

      <section className="workspace">
        <aside>
          {/* Step 1: role brief */}
          <section className={`panel${highlight(0)}`}>
            <div className="section-title"><span>1</span>Role brief</div>
            <label>Role template
              <select value={templateId} disabled={locked} onChange={(event) => applyTemplate(event.target.value)}>
                <option value={BLANK_ROLE}>✍️ Write my own role (blank form)</option>
                <optgroup label="Ready-made roles">
                  {ROLE_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                </optgroup>
                {savedRoles.length > 0 && (
                  <optgroup label="My saved roles">
                    {savedRoles.map((role) => <option key={role.id} value={role.id}>{role.title}</option>)}
                  </optgroup>
                )}
                {templateId === EDITED_ROLE && <option value={EDITED_ROLE}>Edited (your own text)</option>}
              </select>
            </label>
            <p className="helper field-hint">{roleHint}</p>
            {autoFilling && jobBlock}
            <label>Job title <em className="req">required</em>{autoTag("title", !!title)}
              <input ref={titleRef} value={title} readOnly={locked} onChange={(event) => { setTitle(event.target.value); markEdited("title"); }} placeholder="e.g. Marketing Analyst" />
            </label>
            <div className="row">
              <label>Seniority{autoTag("seniority", inferred.seniority !== null)}
                <select value={seniority} disabled={locked} onChange={(event) => { updateSeniority(event.target.value as Seniority); markEdited("seniority"); }}>
                  {SENIORITIES.map((level) => <option key={level}>{level}</option>)}
                </select>
              </label>
              <label>Min. years{autoTag("minYears", minYears !== null)}
                <select value={minYears ?? ""} disabled={locked} onChange={(event) => { setMinYears(event.target.value === "" ? null : Number(event.target.value)); markEdited("minYears"); }}>
                  {(minYears === null || EXPERIENCE_OPTIONS.includes(minYears) ? EXPERIENCE_OPTIONS : [...EXPERIENCE_OPTIONS, minYears].sort((x, y) => (x ?? -1) - (y ?? -1))).map((years) => <option key={years ?? "any"} value={years ?? ""}>{years === null ? "Any" : `${years}+ years`}</option>)}
                </select>
              </label>
            </div>
            <p className="helper field-hint">
              {jobYears !== null && minYears === jobYears
                ? `Detected “${jobYears}+ years” in the job description.`
                : minYears !== null && minYears === SENIORITY_MIN_YEARS[seniority]
                  ? `Default for ${seniority.toLowerCase()} roles. Change it if the role needs more or less.`
                  : minYears === null ? "No minimum: experience is shown on each card but not checked." : "Set by you."}
            </p>
            <div className="row">
              <label>Employment type{autoTag("employmentType", inferred.employmentType !== null)}
                <select value={employmentType} disabled={locked} onChange={(event) => { setEmploymentType(event.target.value as EmploymentType); markEdited("employmentType"); }}>
                  {EMPLOYMENT_TYPES.map((type) => <option key={type}>{type}</option>)}
                </select>
              </label>
              <label>Location{autoTag("location", !!location)}
                <input value={location} readOnly={locked} onChange={(event) => { setLocation(event.target.value); markEdited("location"); }} placeholder="e.g. Sydney (hybrid)" />
              </label>
            </div>
            {!autoFilling && jobBlock}
            <div className="role-actions">
              <button type="button" className="secondary" disabled={locked || !jobReady} onClick={saveRole}>💾 Save as my role</button>
              {isSavedRoleId(templateId) && <button type="button" className="link-danger" disabled={locked} onClick={deleteRole}>Remove saved role</button>}
            </div>
            {roleNote && <p className="helper role-note" role="status">{roleNote}</p>}
          </section>

          {/* Step 2: must-haves */}
          <section className={`panel${highlight(1)}`}>
            <div className="section-title"><span>2</span>Must-have skills</div>
            <p className="helper">Detected from the job description and ticked for you. Untick any that are only “nice to have”.</p>
            <div className="checks">
              {detected.length === 0 && <em className="helper">No known skills found in the description yet. Add your own must-have skills below; Lens will look for them in every resume.</em>}
              {detected.map((skill) => (
                <label key={skill}>
                  <input type="checkbox" disabled={locked} checked={selectedSkills.includes(skill)} onChange={() => setSelectedSkills((current) => current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill])} /> {skill}
                </label>
              ))}
            </div>
            <div className="add-skill">
              <input aria-label="Additional must-have skill" value={newSkill} readOnly={locked} onChange={(event) => setNewSkill(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addMustHaveSkill(); } }} placeholder="Add a skill, e.g. Snowflake" />
              <button type="button" disabled={locked} onClick={addMustHaveSkill}>Add</button>
            </div>
            {additionalSkills.length > 0 && (
              <div className="custom-skills">
                {additionalSkills.map((skill) => <span key={skill}>{skill}<button type="button" aria-label={`Remove ${skill}`} onClick={() => setAdditionalSkills((current) => current.filter((item) => item !== skill))}>×</button></span>)}
              </div>
            )}
          </section>

          {/* Step 3: candidates */}
          <section className={`panel${highlight(2)}`}>
            <div className="section-title"><span>3</span>Candidates</div>
            <label className="upload">Upload resumes (PDF or .txt)
              <input type="file" accept=".pdf,.txt,application/pdf,text/plain" multiple disabled={locked || uploading} onChange={addResumes} />
            </label>
            <p className="helper source-note">
              {uploading ? "Reading resumes in your browser…" : usingDemoCandidates ? `Prefilled with the built-in demo set: ${demoCandidates.length} candidate resumes.` : `${candidates.length} uploaded resume(s) loaded. Files are read in your browser and never uploaded to a server.`}
            </p>
            {uploadNote && <p className="helper upload-note">{uploadNote}</p>}
            {!usingDemoCandidates && <button type="button" className="secondary" disabled={locked} onClick={() => { setCandidates(demoCandidates); setUsingDemoCandidates(true); }}>Use demo candidates instead</button>}
          </section>

          {/* Step 4: review options */}
          <section className={`panel${highlight(3)}`}>
            <div className="section-title"><span>4</span>Review options</div>
            <label>Shortlist size
              <select value={shortlistSize} disabled={locked} onChange={(event) => setShortlistSize(Number(event.target.value))}>
                {SHORTLIST_SIZES.map((size) => <option key={size} value={size}>Top {size}</option>)}
              </select>
            </label>
            <label className="toggle"><input type="checkbox" disabled={locked} checked={strictMustHaveFilter} onChange={(event) => setStrictMustHaveFilter(event.target.checked)} /> Only candidates meeting all must-haves</label>
            <label className="toggle"><input type="checkbox" disabled={locked || minYears === null} checked={experienceFilter && minYears !== null} onChange={(event) => setExperienceFilter(event.target.checked)} /> Only candidates meeting the experience requirement</label>
            <p className="helper">{minYears === null ? "Set a minimum experience in step 1 to use this filter." : "Experience is estimated from the resume and never added to the score. Candidates whose experience is unclear stay visible, flagged for review."}</p>
            <label className="toggle"><input type="checkbox" disabled={locked} checked={blind} onChange={(event) => setBlind(event.target.checked)} /> Blind screening (hide names)</label>
            <button type="button" className="secondary" disabled={locked} onClick={resetForm}>Reset to defaults</button>
          </section>
        </aside>

        <section className={`results${revealed ? "" : " pending"}`} ref={resultsRef}>
          {!revealed ? (
            <div className="placeholder">
              <div className="spinner" aria-hidden="true" />
              <p>{phaseText(phase) ?? "Preparing…"}</p>
              <span>The shortlist appears here when the automated run finishes.</span>
            </div>
          ) : !jobReady ? (
            <div className="placeholder brief-needed">
              <p>Describe the role to see the shortlist</p>
              <ul>
                <li className={title.trim() ? "ok" : ""}>{title.trim() ? "✓" : "○"} Job title</li>
                <li className={job.trim().length >= MIN_JOB_CHARS ? "ok" : ""}>{job.trim().length >= MIN_JOB_CHARS ? "✓" : "○"} Job description ({Math.min(job.trim().length, MIN_JOB_CHARS)}/{MIN_JOB_CHARS} characters)</li>
                <li className="ok">✓ Candidates ({candidates.length} loaded)</li>
              </ul>
              <span>Or pick a ready-made role from Role template to try it straight away.</span>
            </div>
          ) : (
            <>
              <div className="summary">
                <div><span>Resumes analysed</span><strong>{allRanked.length}</strong></div>
                <div><span>Meet all must-haves</span><strong>{allRanked.filter((c) => c.meetsMustHaves).length}</strong></div>
                <div><span>Top evidence match</span><strong>{allRanked[0]?.score ?? 0}%</strong></div>
                <div><span>{minYears === null ? "Experience requirement" : `Meet ${minYears}+ years`}</span><strong>{minYears === null ? "Any" : meetsExperience}</strong></div>
              </div>
              <div className="shortlist-heading">
                <div>
                  <p className="eyebrow">RECOMMENDED SHORTLIST</p>
                  <h2>{title.trim() ? `${seniority} ${title.trim()}` : "Top candidates to review"}</h2>
                  <p>{[location.trim(), employmentType].filter(Boolean).map((part) => `${part} · `).join("")}{strict ? "Showing candidates who meet every selected must-have." : "Showing the highest evidence-based matches for recruiter review."}</p>
                </div>
                <button type="button" onClick={() => exportCsv(ranked, label, experience, highlightsOf)}>Download CSV</button>
              </div>
              {ranked.length === 0
                ? <div className="empty">No candidate passes the current filters. Untick “Only candidates meeting all must-haves” or “Only candidates meeting the experience requirement” in step 4 to review the full candidate pool.</div>
                : <div className="cards top">{shortlist.map((candidate) => candidateCard(candidate))}</div>}
              {alternatives.length > 0 && (
                <section className="alternatives">
                  <p className="eyebrow">ADDITIONAL CANDIDATES FOR REVIEW</p>
                  <h2>Strongest alternatives</h2>
                  <p>These candidates have strong evidence-match scores but are missing a selected must-have{experienceFilterOn ? " or fall below the experience requirement" : ""}.</p>
                  <div className="cards">{alternatives.map((candidate) => candidateCard(candidate, true))}</div>
                </section>
              )}
              {ranked.length > 0 && (
                <section className="table-wrap">
                  <h2>Evidence ranking</h2>
                  <table>
                    <thead><tr><th>Rank</th><th>Candidate</th><th>Score</th><th>Matched skills</th><th>Review status</th></tr></thead>
                    <tbody>{ranked.map((candidate) => (
                      <tr key={candidate.id}><td>{rankOf.get(candidate.id)}</td><td>{label(candidate)}</td><td>{candidate.score}%</td><td>{candidate.matchedSkills.join(", ") || "—"}</td><td>{candidate.meetsMustHaves ? "All must-haves met" : "Review required"}</td></tr>
                    ))}</tbody>
                  </table>
                </section>
              )}
            </>
          )}
        </section>
      </section>
      {evidenceCandidate && (
        <div className="drawer-backdrop" onClick={() => setEvidenceId(null)}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Evidence for ${label(evidenceCandidate)}`} onClick={(event) => event.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <p className="eyebrow">EVIDENCE</p>
                <h2>{label(evidenceCandidate)}</h2>
                <p>{evidenceCandidate.role ?? "Candidate"} · Rank #{rankOf.get(evidenceCandidate.id)}</p>
              </div>
              <button type="button" className="close" aria-label="Close evidence panel" onClick={() => setEvidenceId(null)} autoFocus>×</button>
            </div>
            <div className="drawer-score">
              <ScoreRing score={evidenceCandidate.score} size={96} />
              <div>
                <Breakdown candidate={evidenceCandidate} />
                <p className="formula">{evidenceCandidate.formula === "skills" ? "65% skill coverage + 20% keyword coverage + 15% text similarity" : "75% keyword coverage + 25% text similarity (no catalogue skills in the job)"}</p>
              </div>
            </div>
            <h3>Required skills</h3>
            <ul className="skill-checks">
              {requiredSkills.map((skill) => {
                const mentions = evidence.filter((item) => item.skill === skill);
                const counted = mentions.find((item) => !item.negated);
                const negated = mentions.find((item) => item.negated);
                const state = counted ? "found" : negated ? "negated" : "missing";
                const quote = (counted ?? negated)?.snippet;
                return (
                  <li key={skill} className={state}>
                    <span className="mark">{state === "found" ? "✓" : state === "negated" ? "⊘" : "✕"}</span>
                    <div>
                      <b>{skill}</b>{mustHaves.includes(skill) && <em className="must">must-have</em>}
                      <span>{state === "found" ? `“${quote}”` : state === "negated" ? `Mentioned but negated, so not counted: “${quote}”` : "Not found in this resume"}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <h3>Highlights</h3>
            {(() => {
              const items = highlightsOf(evidenceCandidate);
              if (!items.length) return <p className="helper drawer-empty">No awards, competition results, certifications or internships were found in this resume.</p>;
              const groups = (Object.keys(HIGHLIGHT_LABELS) as HighlightCategory[])
                .map((category) => ({ category, items: items.filter((item) => item.category === category) }))
                .filter((group) => group.items.length);
              return (
                <div className="hl-groups">
                  {groups.map((group) => (
                    <div key={group.category} className={`hl-group hl-${group.category}`}>
                      <p className="hl-title"><i aria-hidden="true">{HIGHLIGHT_LABELS[group.category].icon}</i>{HIGHLIGHT_LABELS[group.category].label}</p>
                      <ul>{group.items.map((item) => <li key={item.text}>{item.text}</li>)}</ul>
                    </div>
                  ))}
                  <p className="helper">Pulled from the resume as written so you can see what stands out. Shown for review; never added to the score.</p>
                </div>
              );
            })()}
            <h3>Experience</h3>
            {(() => {
              const { estimate, status } = experience(evidenceCandidate);
              return (
                <div className={`exp-box exp-${status}`}>
                  <p className="exp-line">
                    <b>{estimate.years === null ? "Experience unclear" : `Estimated ${formatYears(estimate.years)}`}</b>
                    {minYears !== null && <span> · role asks {minYears}+ years · {EXPERIENCE_STATUS_TEXT[status].toLowerCase()}</span>}
                  </p>
                  {estimate.evidence.length > 0 ? (
                    <ul>
                      {estimate.evidence.map((item) => (
                        <li key={`${item.start}-${item.kind}`}><em>{item.kind === "dates" ? "Dates" : "Stated"}</em>“{item.snippet}”</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="helper">No work dates or stated years of experience were found. Education dates are ignored.</p>
                  )}
                  <p className="helper">Estimated from the resume and rounded down to the half year. Shown for review; never added to the score.</p>
                </div>
              );
            })()}
            <h3>Resume text</h3>
            <p className="key"><mark className="hit">counted</mark> <mark className="neg">negated, not counted</mark></p>
            <div className="resume-text">{highlightResume(evidenceCandidate.text, evidence)}</div>
            {blind && <p className="helper drawer-note">Blind screening hides names and file names in the results, but resume text is shown as written.</p>}
          </aside>
        </div>
      )}
      <footer>
        <p>Lens shows its working; people make the hiring decision.</p>
        <p>Designed and built by <a href="https://github.com/Mohit1473" target="_blank" rel="noreferrer">Mohit</a></p>
      </footer>
    </main>
  );
}
