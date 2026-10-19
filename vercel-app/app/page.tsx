"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Candidate, RankedCandidate, demoCandidates, rankCandidates, recogniseSkills } from "../lib/matcher";
import { DEFAULT_TEMPLATE, ROLE_TEMPLATES, SENIORITIES, Seniority, findTemplate } from "../lib/templates";

type Mode = "manual" | "automated";
type StepState = "done" | "active" | "pending";

const STORAGE_KEY = "lens-form-v1";
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

function exportCsv(rows: RankedCandidate[], label: (candidate: RankedCandidate) => string) {
  const header = ["Rank", "Candidate", "Role", "Match score", "Matched skills", "Missing skills", "Must-have status"];
  const lines = rows.map((row, index) => [index + 1, label(row), row.role ?? "", row.score, row.matchedSkills.join("; "), row.missingSkills.join("; "), row.meetsMustHaves ? "All must-haves met" : "Review required"]);
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
  const [restored, setRestored] = useState(false);

  // --- Automated run state ---------------------------------------------------
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(-1); // index into RUN_PHASES, -1 when idle
  const [runMessage, setRunMessage] = useState("");
  const [revealed, setRevealed] = useState(true); // results hidden while an automated run builds up
  const runId = useRef(0);
  const resultsRef = useRef<HTMLElement>(null);

  // --- Restore the last-used form (per browser) -------------------------------
  useEffect(() => {
    try {
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
        if (saved.mode === "manual" || saved.mode === "automated") setMode(saved.mode);
        setRestored(true);
      }
    } catch {
      /* storage unavailable: keep defaults */
    }
  }, []);

  useEffect(() => {
    if (running) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ templateId, title, seniority, location, job, selectedSkills, additionalSkills, strict: strictMustHaveFilter, blind, shortlistSize, mode }));
    } catch {
      /* storage unavailable: nothing to save */
    }
  }, [templateId, title, seniority, location, job, selectedSkills, additionalSkills, strictMustHaveFilter, blind, shortlistSize, mode, running]);

  // --- Ranking ----------------------------------------------------------------
  const detected = useMemo(() => recogniseSkills(job), [job]);
  const mustHaves = useMemo(() => [...new Set([...selectedSkills, ...additionalSkills])], [selectedSkills, additionalSkills]);
  const allRanked = useMemo(() => rankCandidates(candidates, job, mustHaves), [candidates, job, mustHaves]);
  const rankOf = useMemo(() => new Map(allRanked.map((candidate, index) => [candidate.id, index + 1])), [allRanked]);
  const strict = strictMustHaveFilter && mustHaves.length > 0;
  const ranked = strict ? allRanked.filter((candidate) => candidate.meetsMustHaves) : allRanked;
  const shortlist = ranked.slice(0, shortlistSize);
  const alternatives = strict ? allRanked.filter((candidate) => !candidate.meetsMustHaves).slice(0, 3) : [];
  // One label per candidate everywhere (cards, table, CSV), based on overall rank.
  const label = (candidate: RankedCandidate) =>
    blind ? `Candidate ${String(rankOf.get(candidate.id) ?? 0).padStart(4, "0")}` : candidate.id;

  // --- Step tracker -----------------------------------------------------------
  const stepDone = [
    title.trim().length > 0 && job.trim().length > 0,
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
  }

  function applyTemplate(id: string) {
    const template = findTemplate(id);
    setTemplateId(id);
    if (!template) return; // "custom": keep whatever the recruiter typed
    setTitle(template.title);
    setSeniority(template.seniority);
    setLocation(template.location);
    updateJob(template.description);
    setAdditionalSkills([]);
  }

  function addMustHaveSkill() {
    const skill = newSkill.trim();
    if (!skill || mustHaves.some((item) => item.toLowerCase() === skill.toLowerCase())) return;
    setAdditionalSkills((current) => [...current, skill]);
    setNewSkill("");
  }

  function addTextResumes(event: ChangeEvent<HTMLInputElement>) {
    // Windows sometimes reports an empty MIME type for .txt files, so check the extension too.
    const files = Array.from(event.target.files ?? []).filter((file) => file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt"));
    if (!files.length) return;
    const ids = uniqueIds(files.map((file) => file.name.replace(/\.txt$/i, "")));
    Promise.all(files.map(async (file, index) => ({ id: ids[index], text: await file.text(), role: "Uploaded resume" })))
      .then((uploads) => { setCandidates(uploads); setUsingDemoCandidates(false); });
    event.target.value = "";
  }

  function resetForm() {
    stopRun();
    applyTemplate(DEFAULT_TEMPLATE.id);
    setCandidates(demoCandidates);
    setUsingDemoCandidates(true);
    setStrictMustHaveFilter(true);
    setBlind(true);
    setShortlistSize(5);
    setRestored(false);
    setRevealed(true);
  }

  // --- Automated run ------------------------------------------------------------
  function stopRun() {
    runId.current += 1;
    setRunning(false);
    setPhase(-1);
    setRevealed(true);
  }

  async function autoRun() {
    const id = ++runId.current;
    const alive = () => runId.current === id;
    const template = findTemplate(templateId) ?? DEFAULT_TEMPLATE;
    const started = performance.now();
    setMode("automated");
    setRunning(true);
    setRevealed(false);
    setRunMessage("");

    // 1. Role template
    setPhase(0);
    setTemplateId(template.id);
    setTitle(template.title);
    setSeniority(template.seniority);
    setLocation(template.location);
    setSelectedSkills([]);
    setAdditionalSkills([]);
    setJob("");
    await sleep(500);
    if (!alive()) return;

    // 2. Type the job description
    setPhase(1);
    const text = template.description;
    for (let end = 6; end < text.length + 6; end += 6) {
      setJob(text.slice(0, end));
      await sleep(14);
      if (!alive()) return;
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
    setRunMessage(`Done in ${((performance.now() - started) / 1000).toFixed(1)} s. Every field stays editable, so switch to Manual to fine-tune.`);
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --- Rendering ----------------------------------------------------------------
  function candidateCard(candidate: RankedCandidate, reviewOnly = false) {
    return (
      <article className={reviewOnly ? "review-card" : ""} key={candidate.id}>
        <div className="rank">#{rankOf.get(candidate.id)}</div>
        <h3>{label(candidate)}</h3>
        <p>{candidate.role ?? "Candidate"}</p>
        <strong className="score">{candidate.score}<small>/100</small></strong>
        <div className="bar"><i style={{ width: `${Math.min(candidate.score, 100)}%` }} /></div>
        <p className={candidate.meetsMustHaves ? "good" : "warn"}>{candidate.meetsMustHaves ? "✓ All must-haves met" : "⚠ Review required"}</p>
        <div className="skills"><b>Matched</b>{candidate.matchedSkills.length ? candidate.matchedSkills.map((skill) => <span key={skill}>{skill}</span>) : <em>None shown</em>}</div>
        <div className="skills missing"><b>Missing</b>{candidate.missingMustHaves.length ? candidate.missingMustHaves.map((skill) => <span key={skill}>{skill}</span>) : <em>None</em>}</div>
      </article>
    );
  }

  const locked = running; // fields are read-only while the automated run is filling them

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
        {running ? RUN_PHASES[phase]?.text : runMessage || (mode === "automated"
          ? "Automated mode: pick a role template below, then press Auto-run. Lens fills the job description, must-haves and candidates, then ranks them."
          : restored ? "Your last entries were restored. Use Reset to go back to the defaults." : "Manual mode: every field is prefilled with a sensible default — edit anything you like.")}
      </p>

      <section className="workspace">
        <aside>
          {/* Step 1: role brief */}
          <section className={`panel${highlight(0)}`}>
            <div className="section-title"><span>1</span>Role brief</div>
            <label>Role template
              <select value={templateId} disabled={locked} onChange={(event) => applyTemplate(event.target.value)}>
                {ROLE_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                <option value="custom">Custom (keep my text)</option>
              </select>
            </label>
            <label>Job title
              <input value={title} readOnly={locked} onChange={(event) => { setTitle(event.target.value); setTemplateId("custom"); }} placeholder="e.g. Data Analyst" />
            </label>
            <div className="row">
              <label>Seniority
                <select value={seniority} disabled={locked} onChange={(event) => setSeniority(event.target.value as Seniority)}>
                  {SENIORITIES.map((level) => <option key={level}>{level}</option>)}
                </select>
              </label>
              <label>Location
                <input value={location} readOnly={locked} onChange={(event) => setLocation(event.target.value)} placeholder="City (hybrid)" />
              </label>
            </div>
            <label>Job description
              <textarea value={job} readOnly={locked} onChange={(event) => { updateJob(event.target.value); setTemplateId("custom"); }} placeholder="Key skills, responsibilities and outcomes for the role" />
            </label>
          </section>

          {/* Step 2: must-haves */}
          <section className={`panel${highlight(1)}`}>
            <div className="section-title"><span>2</span>Must-have skills</div>
            <p className="helper">Detected from the job description and ticked for you. Untick any that are only “nice to have”.</p>
            <div className="checks">
              {detected.length === 0 && <em className="helper">No catalogue skills found yet.</em>}
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
            <label className="upload">Upload text resumes (.txt)
              <input type="file" accept=".txt,text/plain" multiple disabled={locked} onChange={addTextResumes} />
            </label>
            <p className="helper source-note">{usingDemoCandidates ? `Prefilled with the built-in demo set: ${demoCandidates.length} candidate resumes.` : `${candidates.length} uploaded text resume(s) loaded.`}</p>
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
            <label className="toggle"><input type="checkbox" disabled={locked} checked={blind} onChange={(event) => setBlind(event.target.checked)} /> Blind screening (hide names)</label>
            <button type="button" className="secondary" disabled={locked} onClick={resetForm}>Reset to defaults</button>
          </section>
        </aside>

        <section className={`results${revealed ? "" : " pending"}`} ref={resultsRef}>
          {!revealed ? (
            <div className="placeholder">
              <div className="spinner" aria-hidden="true" />
              <p>{RUN_PHASES[phase]?.text ?? "Preparing…"}</p>
              <span>The shortlist appears here when the automated run finishes.</span>
            </div>
          ) : (
            <>
              <div className="summary">
                <div><span>Resumes analysed</span><strong>{allRanked.length}</strong></div>
                <div><span>Meet all must-haves</span><strong>{allRanked.filter((c) => c.meetsMustHaves).length}</strong></div>
                <div><span>Top evidence match</span><strong>{ranked[0]?.score ?? 0}%</strong></div>
              </div>
              <div className="shortlist-heading">
                <div>
                  <p className="eyebrow">RECOMMENDED SHORTLIST</p>
                  <h2>{title.trim() ? `${seniority} ${title.trim()}` : "Top candidates to review"}</h2>
                  <p>{location.trim() ? `${location.trim()} · ` : ""}{strict ? "Showing candidates who meet every selected must-have." : "Showing the highest evidence-based matches for recruiter review."}</p>
                </div>
                <button type="button" onClick={() => exportCsv(ranked, label)}>Download CSV</button>
              </div>
              {ranked.length === 0
                ? <div className="empty">No candidate meets every selected must-have. Untick “Only candidates meeting all must-haves” in step 4 to review the full candidate pool.</div>
                : <div className="cards top">{shortlist.map((candidate) => candidateCard(candidate))}</div>}
              {alternatives.length > 0 && (
                <section className="alternatives">
                  <p className="eyebrow">ADDITIONAL CANDIDATES FOR REVIEW</p>
                  <h2>Strongest alternatives</h2>
                  <p>These candidates have high evidence-match scores but are missing one or more selected must-haves.</p>
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
      <footer>
        <p>Lens shows its working; people make the hiring decision.</p>
        <p>Designed and built by <a href="https://github.com/Mohit1473" target="_blank" rel="noreferrer">Mohit</a></p>
      </footer>
    </main>
  );
}
