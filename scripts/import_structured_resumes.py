"""Download and sanitise the structured Hugging Face resume demo dataset.

The importer filters recognised identifying fields and redacts common contact
identifiers in retained text. Arbitrary free text can still contain personal
information, so the output remains demo data for human-reviewed use only.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
from typing import Any

from huggingface_hub import hf_hub_download


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PROJECT_ROOT / "data" / "structured" / "structured_resumes.json"
UNKNOWN_VALUES = {"", "unknown", "not provided", "not available", "n/a", "null"}
SENSITIVE_KEY_TOKENS = {
    "address",
    "age",
    "birth",
    "city",
    "college",
    "company",
    "contact",
    "country",
    "date",
    "dates",
    "dob",
    "duration",
    "email",
    "employer",
    "gender",
    "graduation",
    "github",
    "institution",
    "linkedin",
    "link",
    "location",
    "mail",
    "mobile",
    "name",
    "nationality",
    "organisation",
    "organization",
    "period",
    "phone",
    "postal",
    "postcode",
    "profile",
    "reference",
    "references",
    "referee",
    "school",
    "state",
    "supervisor",
    "university",
    "url",
    "website",
    "year",
    "zip",
}
SENSITIVE_COMPACT_FIELD_NAMES = {
    "companyname",
    "contactmobile",
    "emailaddress",
    "enddate",
    "fullname",
    "graduationyear",
    "joblocation",
    "linkedinurl",
    "phonenumber",
    "startdate",
}
TITLE_KEYS = frozenset({"name", "title"})
EMAIL_PATTERN = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
URL_PATTERN = re.compile(
    r"\b(?:https?://|www\.)\S+|\b(?:linkedin|github|gitlab|twitter|x|behance|medium)\.com/\S*",
    re.I,
)
PHONE_PATTERN = re.compile(r"(?<!\w)(?:\(?\+?\d[\d().\s-]{5,}\d\)?)(?!\w)")
DATE_RANGE_PATTERN = re.compile(r"(?:19|20)\d{2}\s*[-–]\s*(?:19|20)\d{2}")


def normalized_field_name(value: object) -> str:
    """Return a comparable field name from mixed dataset naming conventions."""
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def is_sensitive_field(key: object) -> bool:
    """Return whether a mixed-format field name contains identifying data."""
    parts = re.split(r"[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])", str(key))
    tokens = {part.lower() for part in parts if part}
    return bool(tokens & SENSITIVE_KEY_TOKENS) or (
        normalized_field_name(key) in SENSITIVE_COMPACT_FIELD_NAMES
    )


def redact_sensitive_text(value: str) -> str:
    """Remove contact identifiers while preserving ordinary text and date ranges."""
    redacted = EMAIL_PATTERN.sub("[redacted email]", value)
    redacted = URL_PATTERN.sub("[redacted link]", redacted)

    def redact_phone(match: re.Match[str]) -> str:
        candidate = match.group(0)
        if DATE_RANGE_PATTERN.fullmatch(candidate):
            return candidate
        digit_count = sum(character.isdigit() for character in candidate)
        return "[redacted phone]" if digit_count >= 7 else candidate

    return PHONE_PATTERN.sub(redact_phone, redacted)


def strings(value: Any, allowed_keys: frozenset[str] = frozenset()) -> list[str]:
    """Flatten privacy-safe text, preserving selected safe object field names."""
    if isinstance(value, str):
        cleaned = redact_sensitive_text(value).strip()
        return [] if cleaned.lower() in UNKNOWN_VALUES else [cleaned]
    if isinstance(value, list):
        return [
            item for value_item in value for item in strings(value_item, allowed_keys)
        ]
    if isinstance(value, dict):
        return [
            item
            for key, value_item in value.items()
            if normalized_field_name(key) in allowed_keys or not is_sensitive_field(key)
            for item in strings(value_item, allowed_keys)
        ]
    return []


def certification_names(value: Any) -> list[str]:
    """Extract only human-readable certificate titles from mixed source formats."""
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned.startswith(("{", "[")):
            try:
                return certification_names(json.loads(cleaned))
            except json.JSONDecodeError:
                names = re.findall(r'"name"\s*:\s*"([^"]+)"', cleaned)
                if names:
                    return names
        return strings(cleaned)
    if isinstance(value, list):
        return [item for value_item in value for item in certification_names(value_item)]
    if isinstance(value, dict):
        for field in ("name", "title", "certification_name", "certificate"):
            if value.get(field):
                return certification_names(value[field])
        return []
    return []


def unique(values: list[str], limit: int = 12) -> list[str]:
    """Return de-duplicated display values without unbounded cards."""
    return list(dict.fromkeys(values))[:limit]


def sanitize_candidate_record(row: dict[str, Any], index: int) -> dict[str, Any] | None:
    """Keep only approved, de-identified candidate fields from one source record."""
    experience_records = row.get("experience") or []
    experience = unique(strings(experience_records))
    role_titles = unique(
        [
            redact_sensitive_text(str(record.get("title", "")).strip())
            for record in experience_records
            if isinstance(record, dict) and record.get("title")
        ],
        1,
    )
    projects = unique(strings(row.get("projects"), TITLE_KEYS))
    skills = unique(strings(row.get("skills"), TITLE_KEYS), limit=30)
    certifications = unique(certification_names(row.get("certifications")))
    internships = unique(strings(row.get("internships")))
    achievements = unique(strings(row.get("achievements")))
    personal_info = row.get("personal_info") or {}
    summary = unique(strings(personal_info.get("summary", "")), 1)
    text = " ".join(
        summary + experience + projects + skills + certifications + internships + achievements
    )
    if not text.strip():
        return None
    return {
        "candidate_id": f"Candidate {index + 1:04d}",
        "primary_role": role_titles[0] if role_titles else "General candidate",
        "skills": skills,
        "experience": experience,
        "projects": projects,
        "certifications": certifications,
        "internships": internships,
        "achievements": achievements,
        "text": text,
    }


def load_sanitized_candidates() -> list[dict[str, Any]]:
    """Download source records and return only privacy-safe candidate fields."""
    source_path = hf_hub_download(
        repo_id="hehhe89/resumes",
        repo_type="dataset",
        filename="master_resumes.jsonl",
    )
    candidates = []
    with Path(source_path).open(encoding="utf-8") as source_file:
        rows = (json.loads(line) for line in source_file if line.strip())
        for index, row in enumerate(rows):
            candidate = sanitize_candidate_record(row, index)
            if candidate:
                candidates.append(candidate)

    return candidates


def main() -> None:
    candidates = load_sanitized_candidates()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(candidates, indent=2), encoding="utf-8")
    print(f"Saved {len(candidates):,} privacy-sanitized candidates to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
