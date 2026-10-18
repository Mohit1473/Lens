"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { Candidate, demoCandidates, rankCandidates, recogniseSkills } from "../lib/matcher";

const DEFAULT_JOB = "We are seeking a data analyst with experience in Python, SQL, data visualization, statistics, and stakeholder communication. The role involves cleaning datasets, building reports, and presenting insights.";

function exportCsv(rows: ReturnType<typeof rankCandidates>) {
  const header = ["Rank", "Candidate", "Role", "Match score", "Matched skills", "Missing skills", "Must-have status"];
  const lines = rows.map((row, index) => [index + 1, row.id, row.role ?? "", row.score, row.matchedSkills.join("; "), row.missingSkills.join("; "), row.meetsMustHaves ? "All must-haves met" : "Review required"]);
  const csv = [header, ...lines].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "resume-match-results.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

export default function Home() {
  const [job, setJob] = useState(DEFAULT_JOB);
  const [candidates, setCandidates] = useState<Candidate[]>(demoCandidates);
  const [blind, setBlind] = useState(true);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(recogniseSkills(DEFAULT_JOB));
  const [additionalSkills, setAdditionalSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [strictMustHaveFilter, setStrictMustHaveFilter] = useState(true);
  const [usingDemoCandidates, setUsingDemoCandidates] = useState(true);
  const detected = useMemo(() => recogniseSkills(job), [job]);
  const mustHaves = useMemo(() => [...new Set([...selectedSkills, ...additionalSkills])], [selectedSkills, additionalSkills]);
  const allRanked = useMemo(() => rankCandidates(candidates, job, mustHaves), [candidates, job, mustHaves]);
  const ranked = strictMustHaveFilter && mustHaves.length
    ? allRanked.filter((candidate) => candidate.meetsMustHaves)
    : allRanked;
  const shortlist = ranked.slice(0, 5);
  const alternatives = strictMustHaveFilter && mustHaves.length
    ? allRanked.filter((candidate) => !candidate.meetsMustHaves).slice(0, 3)
    : [];

  function updateJob(value: string) {
    setJob(value);
    setSelectedSkills(recogniseSkills(value));
  }

  function addMustHaveSkill() {
    const skill = newSkill.trim();
    if (!skill || mustHaves.some((item) => item.toLowerCase() === skill.toLowerCase())) return;
    setAdditionalSkills((current) => [...current, skill]);
    setNewSkill("");
  }

  function addTextResumes(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type === "text/plain");
    Promise.all(files.map(async (file, index) => ({ id: `Candidate ${String(index + 1).padStart(4, "0")}`, text: await file.text(), role: "Uploaded resume" })))
      .then((uploads) => { setCandidates(uploads); setUsingDemoCandidates(false); });
  }

  function candidateCard(candidate: (typeof allRanked)[number], index: number, reviewOnly = false) {
    const fullRank = allRanked.findIndex((item) => item.id === candidate.id) + 1;
    return <article className={reviewOnly ? "review-card" : ""} key={candidate.id}><div className="rank">#{fullRank || index + 1}</div><h3>{blind ? `Candidate ${String(fullRank || index + 1).padStart(4, "0")}` : candidate.id}</h3><p>{candidate.role ?? "Candidate"}</p><strong className="score">{candidate.score}<small>/100</small></strong><div className="bar"><i style={{ width: `${candidate.score}%` }} /></div><p className={candidate.meetsMustHaves ? "good" : "warn"}>{candidate.meetsMustHaves ? "✓ All must-haves met" : "⚠ Review required"}</p><div className="skills"><b>Matched</b>{candidate.matchedSkills.length ? candidate.matchedSkills.map((skill) => <span key={skill}>{skill}</span>) : <em>None shown</em>}</div><div className="skills missing"><b>Missing</b>{candidate.missingMustHaves.length ? candidate.missingMustHaves.map((skill) => <span key={skill}>{skill}</span>) : <em>None</em>}</div></article>;
  }

  return <main>
    <header>
      <h1>Lens</h1>
    </header>
    <section className="workspace">
      <aside>
        <div className="guide"><b>Write a useful role brief</b><span>Include the job title, key skills, main responsibilities, and the outcomes the person should deliver.</span></div>
        <label>Job description<textarea value={job} onChange={(event) => updateJob(event.target.value)} /></label>
        <div className="section-title">Must-have skills</div>
        <p className="helper">Skills found in the job description are selected automatically. Recruiters can remove any that are only preferred.</p>
        <div className="checks">{detected.map((skill) => <label key={skill}><input type="checkbox" checked={selectedSkills.includes(skill)} onChange={() => setSelectedSkills((current) => current.includes(skill) ? current.filter((item) => item !== skill) : [...current, skill])} /> {skill}</label>)}</div>
        <div className="add-skill"><input aria-label="Additional must-have skill" value={newSkill} onChange={(event) => setNewSkill(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addMustHaveSkill(); } }} placeholder="Add a skill, e.g. Snowflake" /><button type="button" onClick={addMustHaveSkill}>Add</button></div>
        {additionalSkills.length > 0 && <div className="custom-skills">{additionalSkills.map((skill) => <span key={skill}>{skill}<button type="button" aria-label={`Remove ${skill}`} onClick={() => setAdditionalSkills((current) => current.filter((item) => item !== skill))}>×</button></span>)}</div>}
        <label className="toggle"><input type="checkbox" checked={strictMustHaveFilter} onChange={(event) => setStrictMustHaveFilter(event.target.checked)} /> Show only candidates meeting all must-haves</label>
        <p className="helper">All resumes are analysed. Turn this off to review candidates who are missing one or more requirements.</p>
        <label className="toggle"><input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} /> Blind screening</label>
        <label className="upload">Upload text resumes<input type="file" accept=".txt,text/plain" multiple onChange={addTextResumes} /></label>
        <p className="helper source-note">{usingDemoCandidates ? "Using the built-in demo set: 5 candidate resumes." : `${candidates.length} uploaded text resume(s) loaded.`}</p>
        <button className="secondary" onClick={() => { setCandidates(demoCandidates); setUsingDemoCandidates(true); }}>Use demo candidates</button>
      </aside>
      <section className="results">
        <div className="summary"><div><span>Resumes analysed</span><strong>{allRanked.length}</strong></div><div><span>Shown after filter</span><strong>{ranked.length}</strong></div><div><span>Top evidence match</span><strong>{ranked[0]?.score ?? 0}%</strong></div></div>
        <div className="shortlist-heading"><div><p className="eyebrow">RECOMMENDED SHORTLIST</p><h2>Top candidates to review</h2><p>{strictMustHaveFilter && mustHaves.length ? "Showing candidates who meet every selected must-have." : "Showing the highest evidence-based matches for recruiter review."}</p></div><button onClick={() => exportCsv(ranked)}>Download CSV</button></div>
        {ranked.length === 0 ? <div className="empty">No candidate meets every selected must-have. Turn off the strict filter in the recruiter panel to review the full candidate pool.</div> : <div className="cards">{shortlist.map((candidate, index) => candidateCard(candidate, index))}</div>}
        {alternatives.length > 0 && <section className="alternatives"><p className="eyebrow">ADDITIONAL CANDIDATES FOR REVIEW</p><h2>Strongest alternatives</h2><p>These candidates have high evidence-match scores but are missing one or more selected must-haves.</p><div className="cards">{alternatives.map((candidate, index) => candidateCard(candidate, index, true))}</div></section>}
        {ranked.length > 0 && <section className="table-wrap"><h2>Evidence ranking</h2><table><thead><tr><th>Rank</th><th>Candidate</th><th>Score</th><th>Matched skills</th><th>Review status</th></tr></thead><tbody>{ranked.map((candidate, index) => <tr key={candidate.id}><td>{index + 1}</td><td>{blind ? `Candidate ${String(index + 1).padStart(4, "0")}` : candidate.id}</td><td>{candidate.score}%</td><td>{candidate.matchedSkills.join(", ") || "—"}</td><td>{candidate.meetsMustHaves ? "All must-haves met" : "Review required"}</td></tr>)}</tbody></table></section>}
      </section>
    </section>
    <footer>Recommendations support human review. They do not make automated hiring decisions.</footer>
  </main>;
}
