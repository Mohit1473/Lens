"""Streamlit interface for Lens.

Layout: inputs live in the sidebar; results are kept in session state and shown
as a dashboard (KPI cards + tabs) so that interacting with charts, filters or
comparisons never clears the analysis.
"""

from html import escape
from pathlib import Path
import json
import sys
from tempfile import TemporaryDirectory

import altair as alt
import pandas as pd
import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.resume_matcher import (
    FALLBACK_SCORE_WEIGHTS,
    SCORE_WEIGHTS,
    blind_screen_results,
    build_decision_report,
    rank_pdf_resumes,
    rank_structured_resumes,
    recognize_skills,
    score_contributions,
)
from scripts.import_structured_resumes import load_sanitized_candidates


DEFAULT_JOB_DESCRIPTION = (
    "We are seeking a data analyst with experience in Python, SQL, data "
    "visualization, statistics, and stakeholder communication. The role "
    "involves cleaning datasets, building reports, and presenting insights."
)
STRUCTURED_DATASET_PATH = PROJECT_ROOT / "data" / "structured" / "structured_resumes.json"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
SOURCE_UPLOAD = "Upload PDF resumes"
SOURCE_DATASET = "Structured demo dataset"

# --- Visual tokens ----------------------------------------------------------
# Categorical slots 1-3 of the validated reference palette (blue, orange, aqua).
# They pass colour-blind separation checks as a set; aqua is below 3:1 contrast,
# so every chart that uses it also has a tooltip and a table view.
COMPONENT_COLORS = {
    "Skill coverage": "#2a78d6",
    "Keyword coverage": "#eb6834",
    "Text similarity": "#1baf7a",
}
CANDIDATE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"]
SEQUENTIAL_BLUE = "#256abf"
INK = "#0b0b0b"
INK_SECONDARY = "#52514e"
INK_MUTED = "#898781"
GRIDLINE = "#e1e0d9"
BASELINE = "#c3c2b7"
NEUTRAL_FILL = "#f0efec"
FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

PAGE_CSS = f"""
<style>
  .block-container {{ padding-top: 2rem; padding-bottom: 3rem; }}
  .jrm-hero h1 {{ font-size: 2rem; font-weight: 700; margin: 0 0 .25rem 0; color: {INK}; }}
  .jrm-hero p {{ color: {INK_SECONDARY}; margin: 0; font-size: 1rem; }}
  .jrm-pill {{ display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .78rem;
              background: #e8f0fb; color: #184f95; margin: .5rem .35rem 0 0; font-weight: 600; }}
  .jrm-kpi {{ background: #fcfcfb; border: 1px solid rgba(11,11,11,.10); border-radius: 14px;
             padding: 16px 18px; height: 100%; }}
  .jrm-kpi .label {{ color: {INK_SECONDARY}; font-size: .82rem; font-weight: 600;
                    text-transform: uppercase; letter-spacing: .04em; }}
  .jrm-kpi .value {{ color: {INK}; font-size: 2rem; font-weight: 700; line-height: 1.2; margin-top: 4px; }}
  .jrm-kpi .note {{ color: {INK_MUTED}; font-size: .85rem; margin-top: 2px; }}
  .jrm-card {{ background: #fcfcfb; border: 1px solid rgba(11,11,11,.10); border-radius: 16px;
              padding: 18px 20px; height: 100%; }}
  .jrm-card h3 {{ margin: 0; font-size: 1.15rem; color: {INK}; }}
  .jrm-card .role {{ color: {INK_SECONDARY}; font-size: .9rem; margin-bottom: 10px; }}
  .jrm-card .score {{ font-size: 2.4rem; font-weight: 700; color: {INK}; line-height: 1.1; }}
  .jrm-card .score small {{ font-size: 1rem; color: {INK_MUTED}; font-weight: 500; }}
  .jrm-card .section {{ color: {INK_SECONDARY}; font-size: .78rem; font-weight: 700;
                       text-transform: uppercase; letter-spacing: .04em; margin: 14px 0 6px; }}
  .jrm-card .evidence {{ color: {INK}; font-size: .9rem; margin: 2px 0; }}
  .jrm-chip {{ display: inline-block; padding: 3px 10px; margin: 0 6px 6px 0; border-radius: 999px;
              font-size: .8rem; font-weight: 600; }}
  .jrm-chip.matched {{ background: #e8f0fb; color: #184f95; }}
  .jrm-chip.missing {{ background: transparent; color: {INK_SECONDARY};
                      border: 1px dashed {BASELINE}; }}
  .jrm-chip.none {{ color: {INK_MUTED}; padding-left: 0; }}
  .jrm-badge {{ display: inline-block; padding: 3px 10px; border-radius: 8px; font-size: .82rem;
               font-weight: 600; margin-top: 8px; }}
  .jrm-badge.good {{ background: #e7f6e7; color: #006300; }}
  .jrm-badge.warn {{ background: #fff4dc; color: #7a4f00; }}
  .jrm-badge.neutral {{ background: {NEUTRAL_FILL}; color: {INK_SECONDARY}; }}
  .jrm-bar {{ display: flex; gap: 2px; height: 10px; border-radius: 4px; overflow: hidden;
             background: {NEUTRAL_FILL}; margin: 8px 0 6px; }}
  .jrm-bar span {{ display: block; height: 100%; }}
  .jrm-legend {{ color: {INK_SECONDARY}; font-size: .8rem; }}
  .jrm-legend i {{ display: inline-block; width: 9px; height: 9px; border-radius: 2px;
                  margin: 0 4px 0 10px; vertical-align: middle; }}
  .jrm-legend i:first-child {{ margin-left: 0; }}
  .jrm-step {{ background: #fcfcfb; border: 1px solid rgba(11,11,11,.10); border-radius: 14px;
              padding: 18px; height: 100%; }}
  .jrm-step b {{ display: block; color: {INK}; margin-bottom: 4px; }}
  .jrm-step span {{ color: {INK_SECONDARY}; font-size: .92rem; }}
</style>
"""


# --- Data helpers -----------------------------------------------------------
@st.cache_data(show_spinner=False)
def load_structured_candidates() -> list[dict[str, object]]:
    """Load local structured data or retrieve a privacy-safe runtime fallback."""
    if STRUCTURED_DATASET_PATH.is_file():
        return json.loads(STRUCTURED_DATASET_PATH.read_text(encoding="utf-8"))
    return load_sanitized_candidates()


def split_skills(value: object) -> list[str]:
    """Turn a "Python, SQL" result cell into a list ("—" means none)."""
    text = str(value or "").strip()
    return [] if text in {"", "—", "-"} else [part.strip() for part in text.split(",")]


def role_of(row: pd.Series) -> str:
    """Primary role for structured candidates, category for uploaded PDFs."""
    return str(row.get("Primary role", row.get("Category", "Candidate")))


def build_display_frame(results: list[dict], blind_screening: bool) -> pd.DataFrame:
    """Results as a DataFrame, anonymised when blind screening is on."""
    frame = pd.DataFrame(blind_screen_results(results) if blind_screening else results)
    frame.insert(0, "Rank", range(1, len(frame) + 1))
    # Chart axes need unique labels; uploaded files can share a name.
    duplicated = frame["Candidate"].duplicated(keep=False)
    frame["Label"] = [
        f"#{rank} {name}" if dup else str(name)
        for rank, name, dup in zip(frame["Rank"], frame["Candidate"], duplicated)
    ]
    return frame


def contributions_frame(frame: pd.DataFrame, has_required_skills: bool) -> pd.DataFrame:
    """Long-format table of score points per component, for stacked charts."""
    rows = []
    for _, row in frame.iterrows():
        for component, points in score_contributions(row.to_dict(), has_required_skills).items():
            rows.append(
                {
                    "Label": row["Label"],
                    "Component": component,
                    "Points": round(points, 1),
                    "Component value": float(row.get(component, 0.0)),
                    "Match score": float(row["Match score"]),
                }
            )
    return pd.DataFrame(rows)


# --- Chart styling ----------------------------------------------------------
def styled(chart: alt.Chart) -> alt.Chart:
    """Recessive axes and grid, system font, transparent background."""
    return (
        chart.configure(background="transparent", font=FONT)
        .configure_view(strokeWidth=0)
        .configure_axis(
            gridColor=GRIDLINE,
            domainColor=BASELINE,
            tickColor=BASELINE,
            labelColor=INK_SECONDARY,
            titleColor=INK_SECONDARY,
            labelFontSize=12,
            titleFontSize=12,
            titleFontWeight="normal",
        )
        .configure_legend(
            labelColor=INK_SECONDARY,
            titleColor=INK_SECONDARY,
            labelFontSize=12,
            orient="top",
            title=None,
            symbolType="square",
        )
        .configure_title(color=INK, fontSize=14, anchor="start", fontWeight=600)
    )


def component_scale(components: list[str]) -> alt.Scale:
    return alt.Scale(domain=components, range=[COMPONENT_COLORS[c] for c in components])


def breakdown_chart(frame: pd.DataFrame, has_required_skills: bool, top_n: int = 10) -> alt.Chart:
    """Stacked horizontal bars: how many points each component gave the top candidates."""
    top = frame.head(top_n)
    data = contributions_frame(top, has_required_skills)
    components = list(SCORE_WEIGHTS if has_required_skills else FALLBACK_SCORE_WEIGHTS)
    data["order"] = data["Component"].map({c: i for i, c in enumerate(components)})
    chart = (
        alt.Chart(data)
        .mark_bar(height=18, stroke="#f9f9f7", strokeWidth=2)
        .encode(
            y=alt.Y("Label:N", sort=list(top["Label"]), title=None),
            x=alt.X("sum(Points):Q", title="Match score (points)", scale=alt.Scale(domain=[0, 100])),
            color=alt.Color("Component:N", scale=component_scale(components), sort=components),
            order=alt.Order("order:Q"),
            tooltip=[
                alt.Tooltip("Label:N", title="Candidate"),
                alt.Tooltip("Component:N"),
                alt.Tooltip("Component value:Q", title="Component value (%)", format=".1f"),
                alt.Tooltip("Points:Q", title="Points added", format=".1f"),
                alt.Tooltip("Match score:Q", format=".1f"),
            ],
        )
        .properties(height=max(220, 34 * len(top)), title=f"Score breakdown — top {len(top)}")
    )
    return styled(chart)


def distribution_chart(frame: pd.DataFrame) -> alt.Chart:
    """Histogram of match scores across the whole candidate pool."""
    chart = (
        alt.Chart(frame[["Match score"]])
        .mark_bar(color=COMPONENT_COLORS["Skill coverage"], cornerRadiusTopLeft=4,
                  cornerRadiusTopRight=4, stroke="#f9f9f7", strokeWidth=2)
        .encode(
            x=alt.X("Match score:Q", bin=alt.Bin(extent=[0, 100], step=10), title="Match score"),
            y=alt.Y("count():Q", title="Candidates"),
            tooltip=[
                alt.Tooltip("Match score:Q", bin=alt.Bin(extent=[0, 100], step=10), title="Score range"),
                alt.Tooltip("count():Q", title="Candidates"),
            ],
        )
        .properties(height=280, title="Score distribution")
    )
    return styled(chart)


def skill_matrix_chart(frame: pd.DataFrame, required_skills: list[str], top_n: int = 15) -> alt.Chart:
    """Candidate × required-skill grid showing which skills each top candidate shows."""
    top = frame.head(top_n)
    rows = []
    for _, row in top.iterrows():
        matched = set(split_skills(row["Matched skills"]))
        for skill in required_skills:
            found = skill in matched
            rows.append(
                {
                    "Label": row["Label"],
                    "Skill": skill,
                    "Status": "Shown in resume" if found else "Not found",
                    "Mark": "✓" if found else "–",
                }
            )
    data = pd.DataFrame(rows)
    base = alt.Chart(data).encode(
        x=alt.X("Skill:N", sort=required_skills, title=None, axis=alt.Axis(labelAngle=0, orient="top")),
        y=alt.Y("Label:N", sort=list(top["Label"]), title=None),
    )
    cells = base.mark_rect(cornerRadius=4, stroke="#f9f9f7", strokeWidth=3).encode(
        color=alt.Color(
            "Status:N",
            scale=alt.Scale(domain=["Shown in resume", "Not found"], range=[SEQUENTIAL_BLUE, NEUTRAL_FILL]),
        ),
        tooltip=[alt.Tooltip("Label:N", title="Candidate"), "Skill:N", "Status:N"],
    )
    marks = base.mark_text(fontSize=13, fontWeight="bold").encode(
        text="Mark:N",
        color=alt.condition(
            alt.datum.Status == "Shown in resume", alt.value("#ffffff"), alt.value(INK_MUTED)
        ),
    )
    chart = (cells + marks).properties(
        height=max(220, 30 * len(top)), title=f"Required skills — top {len(top)}"
    )
    return styled(chart)


def skill_gap_chart(frame: pd.DataFrame, required_skills: list[str]) -> alt.Chart:
    """How many candidates in the pool are missing each required skill."""
    counts = {skill: 0 for skill in required_skills}
    for value in frame["Missing skills"]:
        for skill in split_skills(value):
            if skill in counts:
                counts[skill] += 1
    total = len(frame)
    data = pd.DataFrame(
        {
            "Skill": list(counts),
            "Missing": list(counts.values()),
            "Share": [count / total * 100 if total else 0 for count in counts.values()],
        }
    )
    chart = (
        alt.Chart(data)
        .mark_bar(color=COMPONENT_COLORS["Keyword coverage"], height=18, cornerRadiusEnd=4)
        .encode(
            y=alt.Y("Skill:N", sort="-x", title=None),
            x=alt.X("Missing:Q", title="Candidates missing this skill", scale=alt.Scale(domain=[0, total])),
            tooltip=[
                "Skill:N",
                alt.Tooltip("Missing:Q", title="Candidates missing"),
                alt.Tooltip("Share:Q", title="% of pool", format=".0f"),
            ],
        )
        .properties(height=max(160, 34 * len(required_skills)), title="Skill gaps across the pool")
    )
    return styled(chart)


def comparison_chart(frame: pd.DataFrame, components: list[str]) -> alt.Chart:
    """Grouped bars comparing component values for up to three candidates."""
    rows = [
        {"Label": row["Label"], "Component": component, "Value": float(row.get(component, 0.0))}
        for _, row in frame.iterrows()
        for component in components
    ]
    labels = list(frame["Label"])
    chart = (
        alt.Chart(pd.DataFrame(rows))
        .mark_bar(cornerRadiusTopLeft=4, cornerRadiusTopRight=4, stroke="#f9f9f7", strokeWidth=2)
        .encode(
            x=alt.X("Component:N", sort=components, title=None, axis=alt.Axis(labelAngle=0)),
            xOffset=alt.XOffset("Label:N", sort=labels),
            y=alt.Y("Value:Q", title="Component value (%)", scale=alt.Scale(domain=[0, 100])),
            color=alt.Color(
                "Label:N", sort=labels,
                scale=alt.Scale(domain=labels, range=CANDIDATE_COLORS[: len(labels)]),
            ),
            tooltip=[alt.Tooltip("Label:N", title="Candidate"), "Component:N",
                     alt.Tooltip("Value:Q", format=".1f")],
        )
        .properties(height=300, title="Score components side by side")
    )
    return styled(chart)


# --- HTML components (all dynamic text is escaped) --------------------------
def kpi_card(label: str, value: str, note: str = "") -> str:
    return (
        f'<div class="jrm-kpi"><div class="label">{escape(label)}</div>'
        f'<div class="value">{escape(value)}</div><div class="note">{escape(note)}</div></div>'
    )


def chips(skills: list[str], kind: str) -> str:
    if not skills:
        return '<span class="jrm-chip none">None</span>'
    marker = "✓ " if kind == "matched" else "✕ "
    return "".join(f'<span class="jrm-chip {kind}">{marker}{escape(s)}</span>' for s in skills)


def status_badge(status: str) -> str:
    if status == "All must-haves met":
        return '<span class="jrm-badge good">✓ All must-haves met</span>'
    if status == "Review required":
        return '<span class="jrm-badge warn">⚠ Review required</span>'
    return f'<span class="jrm-badge neutral">{escape(status)}</span>'


def component_bar(row: pd.Series, has_required_skills: bool) -> str:
    """Mini stacked bar of score points, with a text legend so colour isn't the only cue."""
    parts = score_contributions(row.to_dict(), has_required_skills)
    segments = "".join(
        f'<span style="width:{max(points, 0):.1f}%;background:{COMPONENT_COLORS[name]}" '
        f'title="{escape(name)}: {points:.1f} points"></span>'
        for name, points in parts.items()
    )
    legend = "".join(
        f'<i style="background:{COMPONENT_COLORS[name]}"></i>{escape(name.split()[0])} {points:.0f}'
        for name, points in parts.items()
    )
    return f'<div class="jrm-bar">{segments}</div><div class="jrm-legend">{legend}</div>'


def candidate_card(row: pd.Series, has_required_skills: bool, show_evidence: bool = True) -> str:
    html = [
        '<div class="jrm-card">',
        f"<h3>{escape(str(row['Candidate']))}</h3>",
        f'<div class="role">Rank #{int(row["Rank"])} · {escape(role_of(row))}</div>',
        f'<div class="score">{float(row["Match score"]):.1f}<small> / 100</small></div>',
        component_bar(row, has_required_skills),
        status_badge(str(row.get("Must-have status", ""))),
        '<div class="section">Matched skills</div>',
        chips(split_skills(row.get("Matched skills")), "matched"),
        '<div class="section">Missing skills</div>',
        chips(split_skills(row.get("Missing skills")), "missing"),
    ]
    if show_evidence:
        for column in ("Internships", "Certifications", "Achievements"):
            if column in row and str(row[column]) not in {"", "—"}:
                html.append(f'<div class="section">{column}</div>')
                html.append(f'<div class="evidence">{escape(str(row[column]))}</div>')
    html.append("</div>")
    return "".join(html)


# --- Page sections ----------------------------------------------------------
def render_header(blind_screening: bool) -> None:
    pills = [
        "Explainable scores",
        "Must-have checks",
        f"Blind screening {'on' if blind_screening else 'off'}",
    ]
    st.markdown(
        '<div class="jrm-hero"><h1>Lens</h1>'
        "<p>Rank resumes against a job description, see exactly why each one scored "
        "the way it did, and keep the final decision with a human reviewer.</p>"
        + "".join(f'<span class="jrm-pill">{escape(p)}</span>' for p in pills)
        + "</div>",
        unsafe_allow_html=True,
    )
    st.write("")


def render_empty_state() -> None:
    steps = [
        ("1 · Describe the role", "Paste a job description in the sidebar. Required skills are detected automatically."),
        ("2 · Choose candidates", "Upload PDF resumes, or try the privacy-sanitised demo dataset."),
        ("3 · Analyse", "Get a ranked shortlist with score breakdowns, skill gaps and side-by-side comparison."),
    ]
    for column, (title, text) in zip(st.columns(3), steps, strict=True):
        column.markdown(
            f'<div class="jrm-step"><b>{escape(title)}</b><span>{escape(text)}</span></div>',
            unsafe_allow_html=True,
        )


def render_kpis(frame: pd.DataFrame, must_haves: list[str], skipped: int) -> None:
    top = frame.iloc[0]
    met = int((frame["Must-have status"] == "All must-haves met").sum())
    cards = [
        kpi_card("Candidates analysed", f"{len(frame):,}",
                 f"{skipped} unreadable file(s) skipped" if skipped else "All files readable"),
        kpi_card("Top match", f"{float(top['Match score']):.1f}", str(top["Candidate"])),
        kpi_card(
            "Meet all must-haves",
            f"{met:,}" if must_haves else "—",
            f"{met / len(frame) * 100:.0f}% of candidates" if must_haves else "No must-haves selected",
        ),
        kpi_card("Median match", f"{frame['Match score'].median():.1f}", "Across all candidates"),
    ]
    for column, card in zip(st.columns(4), cards, strict=True):
        column.markdown(card, unsafe_allow_html=True)
    st.write("")


def render_overview(frame: pd.DataFrame, required_skills: list[str]) -> None:
    has_required = bool(required_skills)
    left, right = st.columns([3, 2], gap="large")
    with left:
        st.altair_chart(breakdown_chart(frame, has_required), width="stretch", theme=None)
    with right:
        st.altair_chart(distribution_chart(frame), width="stretch", theme=None)
    formula = " + ".join(
        f"{weight:.0%} {name.lower()}"
        for name, weight in (SCORE_WEIGHTS if has_required else FALLBACK_SCORE_WEIGHTS).items()
    )
    st.caption(f"Match score = {formula}. Hover any bar for exact values; the Ranking tab has the full table.")
    if has_required:
        left, right = st.columns([3, 2], gap="large")
        with left:
            st.altair_chart(skill_matrix_chart(frame, required_skills), width="stretch", theme=None)
        with right:
            st.altair_chart(skill_gap_chart(frame, required_skills), width="stretch", theme=None)
    else:
        st.info("No catalogue skills were found in the job description, so skill charts are hidden.")


def render_ranking(frame: pd.DataFrame) -> None:
    filters = st.columns([2, 2, 3])
    min_score = filters[0].slider("Minimum match score", 0, 100, 0, 5, key="rank_min_score")
    only_met = filters[1].toggle("Must-haves met only", key="rank_only_met")
    search = filters[2].text_input("Search skills or candidate", key="rank_search",
                                   placeholder="e.g. Tableau")
    view = frame[frame["Match score"] >= min_score]
    if only_met:
        view = view[view["Must-have status"] == "All must-haves met"]
    if search.strip():
        needle = search.strip().lower()
        keep = [
            needle in " ".join(str(value) for value in row).lower()
            for row in view.itertuples(index=False)
        ]
        view = view[pd.Series(keep, index=view.index, dtype=bool)]
    table = view.copy()
    table["Matched skills"] = table["Matched skills"].map(split_skills)
    table["Missing skills"] = table["Missing skills"].map(split_skills)
    table["Must-have status"] = table["Must-have status"].map(
        {"All must-haves met": "✓ All met", "Review required": "⚠ Review"}
    ).fillna(table["Must-have status"])
    columns = [c for c in ("Rank", "Candidate", "Primary role", "Category", "Match score",
                           "Matched skills", "Missing skills", "Must-have status") if c in table]
    st.caption(f"Showing {len(table):,} of {len(frame):,} candidates")
    st.dataframe(
        table[columns],
        column_config={
            "Rank": st.column_config.NumberColumn("Rank", width="small"),
            "Match score": st.column_config.ProgressColumn(
                "Match score", min_value=0, max_value=100, format="%.1f"
            ),
            "Matched skills": st.column_config.ListColumn("Matched skills"),
            "Missing skills": st.column_config.ListColumn("Missing skills"),
        },
        hide_index=True,
        width="stretch",
        height=min(560, 38 * (len(table) + 1) + 4),
    )
    with st.expander("How scores are calculated"):
        st.caption(
            "Scores are an assistive ranking signal, not an automated hiring decision. "
            "Review the resume and job-relevant evidence before making a decision."
        )
        breakdown = [c for c in ("Rank", "Candidate", "Match score", "Skill coverage",
                                 "Keyword coverage", "Text similarity", "Score calculation") if c in view]
        st.dataframe(view[breakdown], hide_index=True, width="stretch")


def shortlist(frame: pd.DataFrame, must_haves: list[str], count: int) -> tuple[pd.DataFrame, bool]:
    """Return the evidence-based shortlist and whether every result met must-haves."""
    if must_haves:
        eligible = frame[frame["Must-have status"] == "All must-haves met"]
        if not eligible.empty:
            return eligible.head(count).copy(), True
    return frame.head(count).copy(), not must_haves


def render_shortlist(frame: pd.DataFrame, must_haves: list[str]) -> None:
    """Show an explainable, human-review shortlist of leading candidates."""
    maximum = min(10, len(frame))
    count = st.slider(
        "Candidates to recommend", 1, maximum, min(5, maximum),
        help="Suggestions are ranked evidence for human review, not an automated hiring decision.",
        key="shortlist_count",
    )
    recommended, all_met = shortlist(frame, must_haves, count)
    if must_haves and all_met:
        st.success(
            f"Showing the top {len(recommended)} candidate(s) who meet every selected must-have. "
            "Review their resume evidence before making a decision."
        )
    elif must_haves:
        st.warning(
            "No candidate meets every selected must-have. Showing the strongest evidence-based "
            "matches for review; do not treat this as an approval decision."
        )
    else:
        st.info("Showing the highest evidence-based matches. No must-have filter is active.")

    rows = []
    for _, row in recommended.iterrows():
        matched = split_skills(row.get("Matched skills"))
        rows.append(
            {
                "Rank": int(row["Rank"]),
                "Candidate": row["Candidate"],
                "Match score": float(row["Match score"]),
                "Must-have status": row["Must-have status"],
                "Why recommended": (
                    f"{len(matched)} job skill(s) shown; {float(row['Match score']):.1f}% evidence match"
                ),
                "Matched skills": matched,
                "Missing must-haves": split_skills(row.get("Missing must-haves")),
            }
        )
    table = pd.DataFrame(rows)
    st.dataframe(
        table,
        column_config={
            "Match score": st.column_config.ProgressColumn(
                "Match score", min_value=0, max_value=100, format="%.1f"
            ),
            "Matched skills": st.column_config.ListColumn("Matched skills"),
            "Missing must-haves": st.column_config.ListColumn("Missing must-haves"),
        },
        hide_index=True,
        width="stretch",
    )
    st.caption(
        "The recommendation is based on the visible score components and skill evidence. "
        "It does not reject or decide on any candidate."
    )


def render_compare(frame: pd.DataFrame, required_skills: list[str]) -> None:
    options = list(frame.index)
    chosen = st.multiselect(
        "Choose up to three candidates",
        options=options,
        default=options[: min(3, len(options))],
        format_func=lambda index: f"#{frame.loc[index, 'Rank']} {frame.loc[index, 'Candidate']}",
        max_selections=3,
        key="compare_selection",
    )
    if not chosen:
        st.info("Select at least one candidate to compare.")
        return
    has_required = bool(required_skills)
    for column, index in zip(st.columns(len(chosen)), chosen, strict=True):
        column.markdown(candidate_card(frame.loc[index], has_required), unsafe_allow_html=True)
    st.write("")
    components = list(SCORE_WEIGHTS if has_required else FALLBACK_SCORE_WEIGHTS)
    st.altair_chart(comparison_chart(frame.loc[chosen], components), width="stretch", theme=None)


def render_profile(frame: pd.DataFrame, required_skills: list[str]) -> None:
    options = list(frame.index)
    index = st.selectbox(
        "Candidate",
        options=options,
        format_func=lambda i: f"#{frame.loc[i, 'Rank']} {frame.loc[i, 'Candidate']} — {role_of(frame.loc[i])}",
        key="profile_selection",
    )
    row = frame.loc[index]
    has_required = bool(required_skills)
    left, right = st.columns([2, 3], gap="large")
    with left:
        st.markdown(candidate_card(row, has_required), unsafe_allow_html=True)
    with right:
        st.markdown("#### Why this score")
        weights = SCORE_WEIGHTS if has_required else FALLBACK_SCORE_WEIGHTS
        parts = score_contributions(row.to_dict(), has_required)
        explanation = pd.DataFrame(
            {
                "Component": list(weights),
                "Value (%)": [float(row.get(c, 0.0)) for c in weights],
                "Weight": [f"{w:.0%}" for w in weights.values()],
                "Points added": [round(parts[c], 1) for c in weights],
            }
        )
        st.dataframe(explanation, hide_index=True, width="stretch")
        if has_required:
            matched = split_skills(row.get("Matched skills"))
            missing_must = split_skills(row.get("Missing must-haves"))
            must_text = (
                f"Missing must-haves: **{', '.join(missing_must)}** — check the resume before deciding."
                if missing_must
                else "Meets every selected must-have."
            )
            st.markdown(f"Shows **{len(matched)} of {len(required_skills)}** required skills. {must_text}")
        st.caption("Evidence (internships, certifications, achievements) is shown for review but is not scored.")


def render_export(frame: pd.DataFrame, analysis: dict, blind_screening: bool) -> None:
    export = frame.drop(columns=["Label"])
    left, right = st.columns(2)
    left.download_button(
        "Download ranking (CSV)",
        data=export.to_csv(index=False).encode("utf-8"),
        file_name="resume_match_results.csv",
        mime="text/csv",
        icon=":material/table_view:",
        width="stretch",
    )
    right.download_button(
        "Download decision report (PDF)",
        data=build_decision_report(
            export.to_dict(orient="records"), analysis["job"], analysis["must_haves"]
        ),
        file_name="resume_match_decision_report.pdf",
        mime="application/pdf",
        icon=":material/picture_as_pdf:",
        width="stretch",
    )
    st.caption(
        "Exports use the anonymised labels while blind screening is on."
        if blind_screening
        else "Blind screening is off: exports include candidate names and file names."
    )
    if analysis["errors"]:
        with st.expander(f"Skipped {len(analysis['errors'])} unreadable resume(s)"):
            st.caption("Scanned or image-only PDFs need OCR before their text can be matched.")
            for error in analysis["errors"]:
                st.write(f"• {error}")


# --- Sidebar inputs ---------------------------------------------------------
def sidebar_inputs() -> dict:
    with st.sidebar:
        st.markdown("### Role")
        job_description = st.text_area("Job description", value=DEFAULT_JOB_DESCRIPTION, height=200)
        detected = recognize_skills(job_description)
        if detected:
            must_haves = st.multiselect(
                "Must-have skills",
                options=detected,
                default=detected,
                help="Detected from the job description. Remove skills that are preferred rather than "
                "mandatory. Missing must-haves are flagged for human review, never auto-rejected.",
            )
        else:
            must_haves = []
            st.info("No supported skills detected. Mention skills such as Python, SQL, Excel or AWS.")

        st.markdown("### Candidates")
        source = st.radio("Source", [SOURCE_UPLOAD, SOURCE_DATASET], label_visibility="collapsed")
        uploads, candidates, limit = [], [], 0
        if source == SOURCE_UPLOAD:
            uploads = st.file_uploader("Resumes (PDF, max 10 MB each)", type=["pdf"],
                                       accept_multiple_files=True) or []
            st.caption("Files are processed for this analysis only and deleted immediately afterwards. "
                       "Only upload files you are authorised to process.")
        else:
            try:
                with st.spinner("Preparing privacy-sanitised demo data…"):
                    candidates = load_structured_candidates()
            except OSError as error:
                st.error(f"Unable to load the structured dataset: {error}")
            if candidates:
                maximum = min(500, len(candidates))
                limit = (
                    st.slider("Candidates to analyse", 1, maximum, min(100, maximum),
                              10 if maximum > 10 else 1)
                    if maximum > 1
                    else 1
                )

        st.markdown("### Options")
        blind = st.toggle("Blind screening", value=True,
                          help="Hide candidate names and file names in results and exports.")
        analyse = st.button("Analyse candidates", type="primary", width="stretch",
                            icon=":material/insights:")
    return {
        "job": job_description, "must_haves": must_haves, "source": source, "uploads": uploads,
        "candidates": candidates, "limit": limit, "blind": blind, "analyse": analyse,
    }


def run_analysis(inputs: dict) -> None:
    """Score candidates and keep the results in session state."""
    if not inputs["job"].strip():
        st.sidebar.warning("Enter a job description first.")
        return
    errors: list[str] = []
    if inputs["source"] == SOURCE_UPLOAD:
        uploads = inputs["uploads"]
        if not uploads:
            st.sidebar.warning("Upload at least one PDF resume.")
            return
        oversized = [u.name for u in uploads if u.size > MAX_UPLOAD_BYTES]
        if oversized:
            st.sidebar.error("Each PDF must be 10 MB or smaller. Remove: " + ", ".join(oversized))
            return
        # A temporary directory prevents resumes from being retained between analyses.
        with TemporaryDirectory(prefix="resume-matcher-") as temporary_directory:
            paths = []
            for index, upload in enumerate(uploads, start=1):
                destination = Path(temporary_directory) / f"{index}_{Path(upload.name).name}"
                destination.write_bytes(upload.getvalue())
                paths.append(destination)
            with st.spinner("Extracting resume text and calculating matches…"):
                results, errors = rank_pdf_resumes(paths, inputs["job"], inputs["must_haves"])
    else:
        if not inputs["candidates"]:
            st.sidebar.warning("The demo dataset is not available.")
            return
        with st.spinner(f"Analysing {inputs['limit']} candidates…"):
            results = rank_structured_resumes(
                inputs["candidates"][: inputs["limit"]], inputs["job"], inputs["must_haves"]
            )
    st.session_state["analysis"] = {
        "results": results, "errors": errors, "job": inputs["job"],
        "must_haves": list(inputs["must_haves"]), "source": inputs["source"],
    }


# --- Page -------------------------------------------------------------------
st.set_page_config(page_title="Lens", page_icon="🔎", layout="wide")
st.markdown(PAGE_CSS, unsafe_allow_html=True)

inputs = sidebar_inputs()
if inputs["analyse"]:
    run_analysis(inputs)

render_header(inputs["blind"])
analysis = st.session_state.get("analysis")

if not analysis:
    render_empty_state()
elif not analysis["results"]:
    st.warning("No readable resume text was found.")
    if analysis["errors"]:
        with st.expander(f"Skipped {len(analysis['errors'])} unreadable resume(s)", expanded=True):
            st.caption("Scanned or image-only PDFs need OCR before their text can be matched.")
            for error in analysis["errors"]:
                st.write(f"• {error}")
else:
    if (inputs["job"], list(inputs["must_haves"]), inputs["source"]) != (
        analysis["job"], analysis["must_haves"], analysis["source"]
    ):
        st.info("Inputs changed since the last analysis. Click **Analyse candidates** to refresh.",
                icon=":material/refresh:")
    frame = build_display_frame(analysis["results"], inputs["blind"])
    required_skills = recognize_skills(analysis["job"])
    render_kpis(frame, analysis["must_haves"], len(analysis["errors"]))
    overview, shortlist_tab, ranking, compare, profile, export = st.tabs(
        [":material/insights: Overview", ":material/recommend: Recommended shortlist",
         ":material/leaderboard: Ranking",
         ":material/compare_arrows: Compare", ":material/person: Candidate profile",
         ":material/download: Export"]
    )
    with overview:
        render_overview(frame, required_skills)
    with shortlist_tab:
        render_shortlist(frame, analysis["must_haves"])
    with ranking:
        render_ranking(frame)
    with compare:
        render_compare(frame, required_skills)
    with profile:
        render_profile(frame, required_skills)
    with export:
        render_export(frame, analysis, inputs["blind"])
