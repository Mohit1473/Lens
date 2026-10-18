"""PDF text extraction and lightweight resume-to-job matching."""

from pathlib import Path
from io import BytesIO
from html import escape
import re
from typing import Iterable

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


def extract_pdf_text(pdf_path: str | Path) -> str:
    """Return normalized text from a text-based PDF.

    Raises:
        FileNotFoundError: If the supplied file does not exist.
        ValueError: If no extractable text is found.
    """
    path = Path(pdf_path)
    if not path.is_file():
        raise FileNotFoundError(f"Resume PDF was not found: {path}")

    reader = PdfReader(path)
    text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
    if not text:
        raise ValueError("No text could be extracted. The PDF may be scanned or empty.")
    return text


def score_resume(resume_text: str, job_description: str) -> float:
    """Return a TF-IDF cosine-similarity score as a percentage from 0 to 100."""
    if not resume_text.strip() or not job_description.strip():
        return 0.0

    matrix = TfidfVectorizer(stop_words="english").fit_transform(
        [resume_text, job_description]
    )
    return round(float(cosine_similarity(matrix[0:1], matrix[1:2])[0][0]) * 100, 1)


def rank_resumes(
    resumes: Iterable[tuple[str, str]], job_description: str
) -> list[tuple[str, float]]:
    """Score named resumes and return them in descending match order."""
    scored = [(name, score_resume(text, job_description)) for name, text in resumes]
    return sorted(scored, key=lambda item: item[1], reverse=True)


def discover_dataset_resumes(dataset_dir: str | Path, limit: int | None = None) -> list[Path]:
    """Return sorted PDF paths from a local resume dataset."""
    paths = sorted(Path(dataset_dir).rglob("*.pdf"))
    return paths if limit is None else paths[:limit]


_SKILL_PATTERN_SPECS = {
    "Python": r"\bpython\b",
    "SQL": r"\bsql\b|\bmysql\b|\bpostgres(?:ql)?\b|\bsqlite\b",
    "Excel": (
        r"\b(?:Excel|EXCEL)\b(?!\s+(?:in|at|as|under|when)\b)"
        r"|(?i:\b(?:ms|microsoft|advanced|proficient\s+in|using|in|with)\s+excel\b"
        r"|\bexcel\s+(?:spreadsheets?|workbooks?|formulas?|vba|macros?|pivot|"
        r"dashboards?|reports?|reporting|models?|skills?)\b)"
    ),
    "Tableau": r"\btableau\b",
    "Power BI": r"\bpower\s*bi\b",
    "Data visualisation": (
        r"\b(?:data\s+visuali[sz]ation|tableau|power\s*bi|dashboards?|"
        r"matplotlib|seaborn|plotly)\b"
    ),
    "Statistics": (
        r"\b(?:statistic(?:s|al)?|a/b\s+test(?:s|ing)?|"
        r"hypothesis\s+test(?:s|ing)?)\b"
    ),
    "Machine learning": (
        r"\bmachine\s+learning\b|\bml\s+(?:models?|pipelines?|algorithms?|engineering|ops)\b|"
        r"(?:^|[,;•\n])\s*ml\s*(?=$|[,;•\n])"
    ),
    "Pandas": r"\bpandas\b",
    "NumPy": r"\bnumpy\b",
    "R": r"\br\s+(?:programming|language)\b|\brstudio\b",
    "AWS": r"\baws\b|\bamazon\s+web\s+services\b",
    "Azure": r"\bazure\b",
    "Django": r"\bdjango\b",
    "Flask": r"\bflask\b",
    "Java": r"\bjava\b",
    "JavaScript": r"\bjavascript\b|\btypescript\b",
    "React": (
        r"\breact(?:\.js|js)\b|\breact\s+(?:developer|framework|components?|applications?|apps?|library)\b|"
        r"\b(?:tech\s+stack|skills?|technologies|tools?)\s*:\s*[^.!?\n]*\breact\b|"
        r"(?:^|[,;•\n])\s*react\s*(?=$|[,;•\n])"
    ),
    "Git": r"\bgit(?:hub|lab)?\b",
    "Docker": r"\bdocker\b",
    "REST APIs": (
        r"\brest(?:ful)?\s+api(?:s)?\b|\bapi\s+(?:design|development|integration|"
        r"integrations|endpoints?|gateway|testing)\b"
    ),
    "Project management": r"\bproject\s+management\b",
}

# Patterns are compiled once. Excel deliberately uses case-sensitive matching so
# the common verb "excel" is not treated as the spreadsheet product.
SKILL_PATTERNS: dict[str, re.Pattern[str]] = {
    skill: re.compile(pattern, 0 if skill == "Excel" else re.I)
    for skill, pattern in _SKILL_PATTERN_SPECS.items()
}

_CLAUSE_BOUNDARY = re.compile(r"[.!?;,\n•]|\b(?:but|however|yet|although|and)\b", re.I)
_NEGATION = re.compile(
    r"\b(?:no|not|never|without|lack(?:ing|s)?|unfamiliar)\b"
    r"|n't\b|\bwilling\s+to\s+learn\b",
    re.I,
)


def _find_skills(text: str) -> list[str]:
    """Return recognised skills mentioned in text, preserving catalogue order."""
    return [
        skill
        for skill, pattern in SKILL_PATTERNS.items()
        if _has_affirmed_skill(text, pattern)
    ]


def _has_affirmed_skill(text: str, pattern: re.Pattern[str]) -> bool:
    """Return whether a skill has at least one mention that is not negated.

    Only words before a matched skill, back to the start of its clause, are
    considered. A later negation therefore cannot hide an earlier skill.
    """
    for match in pattern.finditer(text):
        preceding_boundaries = list(_CLAUSE_BOUNDARY.finditer(text, 0, match.start()))
        clause_start = preceding_boundaries[-1].end() if preceding_boundaries else 0
        preceding_words = text[clause_start:match.start()]
        if not _NEGATION.search(preceding_words):
            return True
    return False


def recognize_skills(text: str) -> list[str]:
    """Return catalogue skills recognised in supplied text."""
    return _find_skills(text)


def skill_catalog() -> list[str]:
    """Return skills that recruiters can set as requirements."""
    return list(SKILL_PATTERNS)


def blind_screen_results(
    results: Iterable[dict[str, str | float]],
) -> list[dict[str, str | float]]:
    """Anonymise ranking results and remove file-name identifiers for review."""
    screened = []
    for index, result in enumerate(results, start=1):
        anonymous_result = dict(result)
        anonymous_result["Candidate"] = f"Candidate {index:04d}"
        anonymous_result.pop("File", None)
        screened.append(anonymous_result)
    return screened


def build_decision_report(
    results: Iterable[dict[str, str | float]],
    job_description: str,
    must_have_skills: Iterable[str],
) -> bytes:
    """Create a concise PDF report explaining the candidate ranking."""
    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        leftMargin=1.6 * cm,
        rightMargin=1.6 * cm,
        topMargin=1.6 * cm,
        bottomMargin=1.6 * cm,
        title="Job Resume Matcher - Decision Report",
    )
    styles = getSampleStyleSheet()
    heading = styles["Heading1"]
    heading.textColor = colors.HexColor("#17365D")
    subheading = styles["Heading2"]
    normal = styles["BodyText"]
    normal.leading = 15

    records = list(results)
    must_haves = list(must_have_skills)
    pdf_text = lambda value: escape(str(value).replace("—", "-"))
    story = [Paragraph("Job Resume Matcher - Decision Report", heading), Spacer(1, 8)]
    story.append(
        Paragraph(
            "This report supports human review. It does not make automated hiring decisions.",
            normal,
        )
    )
    story.extend([Spacer(1, 10), Paragraph("Job description", subheading)])
    story.append(Paragraph(pdf_text(job_description[:1500]), normal))
    story.extend([Spacer(1, 10), Paragraph("Screening criteria", subheading)])
    criteria = ", ".join(must_haves) if must_haves else "No must-have skills selected"
    story.append(Paragraph(f"Must-have skills: {pdf_text(criteria)}", normal))
    story.extend([Spacer(1, 12), Paragraph("Candidate ranking", subheading)])

    table_data = [
        ["Candidate", "Match", "Must-have status", "Matched skills", "Missing must-haves"]
    ]
    for record in records[:20]:
        table_data.append(
            [
                Paragraph(pdf_text(record.get("Candidate", "Candidate")), normal),
                Paragraph(f"{float(record.get('Match score', 0.0)):.1f}%", normal),
                Paragraph(pdf_text(record.get("Must-have status", "-")), normal),
                Paragraph(pdf_text(record.get("Matched skills", "-")), normal),
                Paragraph(pdf_text(record.get("Missing must-haves", "-")), normal),
            ]
        )
    table = Table(
        table_data,
        colWidths=[3.0 * cm, 1.5 * cm, 3.4 * cm, 5.0 * cm, 4.0 * cm],
        repeatRows=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17365D")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F7FB")]),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(table)
    document.build(story)
    return output.getvalue()


def _keyword_coverage(resume_text: str, job_description: str) -> float:
    """Measure meaningful job-description words present in the resume."""
    tokens = lambda text: {
        word for word in re.findall(r"[a-zA-Z]{3,}", text.lower())
        if word not in ENGLISH_STOP_WORDS
    }
    job_words = tokens(job_description)
    if not job_words:
        return 0.0
    return len(tokens(resume_text) & job_words) / len(job_words) * 100


# The single source of truth for score weights. Keys match the result columns.
SCORE_WEIGHTS: dict[str, float] = {
    "Skill coverage": 0.65,
    "Keyword coverage": 0.20,
    "Text similarity": 0.15,
}
# Used when the job description contains no catalogue skills.
FALLBACK_SCORE_WEIGHTS: dict[str, float] = {
    "Keyword coverage": 0.75,
    "Text similarity": 0.25,
}


def _match_score(
    skill_coverage: float,
    keyword_coverage: float,
    text_similarity: float,
    has_required_skills: bool,
) -> tuple[float, str]:
    """Apply the single, explainable scoring formula used by every input type."""
    if has_required_skills:
        return (
            SCORE_WEIGHTS["Skill coverage"] * skill_coverage
            + SCORE_WEIGHTS["Keyword coverage"] * keyword_coverage
            + SCORE_WEIGHTS["Text similarity"] * text_similarity,
            "65% skills + 20% keywords + 15% text similarity",
        )
    return (
        FALLBACK_SCORE_WEIGHTS["Keyword coverage"] * keyword_coverage
        + FALLBACK_SCORE_WEIGHTS["Text similarity"] * text_similarity,
        "75% keywords + 25% text similarity",
    )


def score_contributions(
    result: dict[str, str | float], has_required_skills: bool
) -> dict[str, float]:
    """Return how many match-score points each component contributed.

    Used for score-breakdown charts. The values sum to the unrounded match score.
    """
    weights = SCORE_WEIGHTS if has_required_skills else FALLBACK_SCORE_WEIGHTS
    return {
        component: weight * float(result.get(component, 0.0))
        for component, weight in weights.items()
    }


def rank_pdf_resumes(
    pdf_paths: Iterable[str | Path],
    job_description: str,
    must_have_skills: Iterable[str] = (),
) -> tuple[list[dict[str, str | float]], list[str]]:
    """Extract and rank PDFs, returning successful results and skipped-file errors."""
    extracted: list[tuple[Path, str]] = []
    errors: list[str] = []
    for pdf_path in pdf_paths:
        path = Path(pdf_path)
        try:
            extracted.append((path, extract_pdf_text(path)))
        except (OSError, ValueError) as error:
            errors.append(f"{path.name}: {error}")

    if not extracted or not job_description.strip():
        return [], errors

    texts = [text for _, text in extracted]
    try:
        matrix = TfidfVectorizer(stop_words="english").fit_transform(
            [job_description, *texts]
        )
        text_scores = cosine_similarity(matrix[1:], matrix[0:1]).ravel() * 100
    except ValueError:
        text_scores = [0.0] * len(extracted)

    required_skills = _find_skills(job_description)
    must_haves = [skill for skill in must_have_skills if skill in SKILL_PATTERNS]
    ranked = []
    for (path, text), text_score in zip(extracted, text_scores, strict=True):
        resume_skills = set(_find_skills(text))
        matched_skills = [skill for skill in required_skills if skill in resume_skills]
        missing_must_haves = [skill for skill in must_haves if skill not in resume_skills]
        skill_coverage = (
            len(matched_skills) / len(required_skills) * 100 if required_skills else 0.0
        )
        keyword_coverage = _keyword_coverage(text, job_description)
        match_score, score_calculation = _match_score(
            skill_coverage,
            keyword_coverage,
            float(text_score),
            bool(required_skills),
        )
        ranked.append(
            {
                "Candidate": path.stem,
                "Category": (
                    "Uploaded"
                    if path.parent.name == "uploads"
                    or path.parent.name.startswith("resume-matcher-")
                    else path.parent.name.replace("-", " ").title()
                ),
                "Match score": round(float(match_score), 1),
                "Skill coverage": round(skill_coverage, 1),
                "Keyword coverage": round(keyword_coverage, 1),
                "Text similarity": round(float(text_score), 1),
                "Score calculation": score_calculation,
                "Matched skills": ", ".join(matched_skills) or "—",
                "Missing skills": ", ".join(
                    skill for skill in required_skills if skill not in resume_skills
                ) or "—",
                "Must-have status": (
                    "No must-haves selected"
                    if not must_haves
                    else "All must-haves met"
                    if not missing_must_haves
                    else "Review required"
                ),
                "Missing must-haves": ", ".join(missing_must_haves) or "—",
                "File": path.name,
            }
        )
    return sorted(ranked, key=lambda item: float(item["Match score"]), reverse=True), errors


def rank_structured_resumes(
    candidates: Iterable[dict[str, object]],
    job_description: str,
    must_have_skills: Iterable[str] = (),
) -> list[dict[str, str | float]]:
    """Rank privacy-sanitized structured resumes and retain portfolio evidence."""
    records = [candidate for candidate in candidates if str(candidate.get("text", "")).strip()]
    if not records or not job_description.strip():
        return []

    texts = [str(candidate["text"]) for candidate in records]
    try:
        matrix = TfidfVectorizer(stop_words="english").fit_transform(
            [job_description, *texts]
        )
        text_scores = cosine_similarity(matrix[1:], matrix[0:1]).ravel() * 100
    except ValueError:
        text_scores = [0.0] * len(records)

    required_skills = _find_skills(job_description)
    must_haves = [skill for skill in must_have_skills if skill in SKILL_PATTERNS]
    ranked = []
    for candidate, text, text_score in zip(records, texts, text_scores, strict=True):
        profile_skills = set(_find_skills(text))
        missing_must_haves = [skill for skill in must_haves if skill not in profile_skills]
        skill_score = (
            len(profile_skills & set(required_skills)) / len(required_skills) * 100
            if required_skills
            else 0.0
        )
        keyword_coverage = _keyword_coverage(text, job_description)
        match_score, score_calculation = _match_score(
            skill_score,
            keyword_coverage,
            float(text_score),
            bool(required_skills),
        )
        evidence = lambda key: ", ".join(candidate.get(key, [])[:3]) or "—"
        ranked.append(
            {
                "Candidate": str(candidate.get("candidate_id", "Anonymous candidate")),
                "Primary role": str(candidate.get("primary_role", "General candidate")),
                "Match score": round(min(float(match_score), 100.0), 1),
                "Skill coverage": round(skill_score, 1),
                "Keyword coverage": round(keyword_coverage, 1),
                "Text similarity": round(float(text_score), 1),
                "Score calculation": score_calculation,
                "Matched skills": ", ".join(skill for skill in required_skills if skill in profile_skills) or "—",
                "Missing skills": ", ".join(skill for skill in required_skills if skill not in profile_skills) or "—",
                "Must-have status": (
                    "No must-haves selected"
                    if not must_haves
                    else "All must-haves met"
                    if not missing_must_haves
                    else "Review required"
                ),
                "Missing must-haves": ", ".join(missing_must_haves) or "—",
                "Internships": evidence("internships"),
                "Certifications": evidence("certifications"),
                "Achievements": evidence("achievements"),
            }
        )
    return sorted(ranked, key=lambda item: float(item["Match score"]), reverse=True)
