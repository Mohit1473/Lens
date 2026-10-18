import unittest
from pathlib import Path
from io import BytesIO
from scripts.import_structured_resumes import (
    certification_names,
    is_sensitive_field,
    redact_sensitive_text,
    sanitize_candidate_record,
    strings,
)
from pypdf import PdfReader

from src.resume_matcher import (
    blind_screen_results,
    discover_dataset_resumes,
    build_decision_report,
    extract_pdf_text,
    rank_pdf_resumes,
    rank_structured_resumes,
    recognize_skills,
    score_contributions,
    score_resume,
)


class ResumeMatcherTests(unittest.TestCase):
    def test_extracts_only_certification_name_from_json_text(self) -> None:
        value = '{"name": "Python Professional Certificate", "year": "2024"}'
        self.assertEqual(certification_names(value), ["Python Professional Certificate"])

    def test_extracts_names_from_multiple_serialized_certifications(self) -> None:
        value = '{"name": "AWS Cloud"}, {"name": "Python Associate"}'
        self.assertEqual(certification_names(value), ["AWS Cloud", "Python Associate"])

    def test_sanitizes_sensitive_nested_fields_and_contact_identifiers(self) -> None:
        candidate = sanitize_candidate_record(
            {
                "personal_info": {
                    "summary": "Analyst: jane@example.com, https://example.com, +61 412 345 678"
                },
                "experience": [
                    {
                        "title": "Data Analyst",
                        "company": "Private Corp",
                        "location": "Sydney",
                        "start_date": "2019-2021",
                        "description": "Built SQL reports from 2019-2021.",
                    }
                ],
                "skills": ["Python", "SQL"],
            },
            0,
        )
        self.assertIsNotNone(candidate)
        text = str(candidate["text"])
        self.assertIn("[redacted email]", text)
        self.assertIn("[redacted link]", text)
        self.assertIn("[redacted phone]", text)
        self.assertIn("2019-2021", text)
        self.assertNotIn("Private Corp", text)
        self.assertNotIn("Sydney", text)

    def test_drops_sensitive_fields_by_key_word(self) -> None:
        kept = strings(
            {
                "title": "Data Analyst",
                "employer_name": "Acme Pty",
                "job_location": "Sydney",
                "full_name": "Jane Citizen",
                "references": ["Bob Smith"],
                "graduation_year": "2015",
                "description": "Built SQL reports",
            }
        )
        self.assertEqual(kept, ["Data Analyst", "Built SQL reports"])

    def test_redacts_bare_profile_links(self) -> None:
        text = redact_sensitive_text("See linkedin.com/in/janedoe and github.com/janedoe")
        self.assertNotIn("janedoe", text)

    def test_all_caps_keys_are_sensitive(self) -> None:
        self.assertTrue(is_sensitive_field("COMPANY_NAME"))
        self.assertFalse(is_sensitive_field("STATEMENT"))

    def test_skill_and_project_names_survive_sanitisation(self) -> None:
        candidate = sanitize_candidate_record(
            {
                "skills": [{"name": "Python", "level": "Expert"}],
                "projects": [{"name": "Churn dashboard", "company": "Acme"}],
            },
            0,
        )
        self.assertIsNotNone(candidate)
        self.assertIn("Python", candidate["skills"])
        self.assertIn("Churn dashboard", candidate["projects"])
        self.assertNotIn("Acme", candidate["text"])

    def test_extracts_the_sample_resume(self) -> None:
        project_root = Path(__file__).resolve().parents[1]
        text = extract_pdf_text(project_root / "data" / "Sample_Resume.pdf")
        self.assertTrue(text.strip())

    def test_matching_score_is_a_percentage(self) -> None:
        score = score_resume("Python SQL machine learning", "Python developer with SQL")
        self.assertGreater(score, 0)
        self.assertLessEqual(score, 100)

    def test_recognises_supported_job_skills(self) -> None:
        self.assertEqual(
            recognize_skills("Python, SQL, and Tableau"),
            ["Python", "SQL", "Tableau", "Data visualisation"],
        )

    def test_avoids_common_skill_false_positives(self) -> None:
        self.assertEqual(
            recognize_skills("I react quickly and Excel in teams with 500 ml and an API."),
            [],
        )

    def test_excel_product_vs_verb(self) -> None:
        for text in (
            "Automated Excel reporting",
            "EXCEL, SQL",
            "built models in excel",
            "excel pivot tables",
            "Proficient in MS Excel",
        ):
            with self.subTest(text=text):
                self.assertIn("Excel", recognize_skills(text))
        for text in (
            "Built teams that excel in delivery",
            "Excel in fast-paced teams",
            "eager to excel at work",
        ):
            with self.subTest(text=text):
                self.assertNotIn("Excel", recognize_skills(text))

    def test_infers_capability_skills_from_common_tools_and_methods(self) -> None:
        visualisation_skills = recognize_skills("Tableau and Power BI dashboards")
        self.assertIn("Data visualisation", visualisation_skills)
        statistics_skills = recognize_skills("Ran A/B tests and hypothesis testing")
        self.assertIn("Statistics", statistics_skills)

    def test_ignores_negated_skills(self) -> None:
        self.assertEqual(
            recognize_skills("I have no experience with Python or SQL."),
            [],
        )

    def test_recognises_skills_in_technical_context(self) -> None:
        skills = recognize_skills("Tech stack: React, Node.js. Built dashboards in Excel.")
        self.assertIn("React", skills)
        self.assertIn("Excel", skills)

    def test_ignores_additional_negated_skill_phrases(self) -> None:
        self.assertNotIn("Python", recognize_skills("No Python experience."))
        self.assertNotIn("Java", recognize_skills("I don't know Java."))
        self.assertNotIn("AWS", recognize_skills("Willing to learn AWS."))

    def test_negation_does_not_cross_contrast_clause(self) -> None:
        self.assertEqual(
            recognize_skills("No experience with Python, but strong SQL."),
            ["SQL"],
        )

    def test_negation_only_applies_before_the_skill(self) -> None:
        self.assertIn("Python", recognize_skills("Python developer with no Java experience"))
        self.assertNotIn("Java", recognize_skills("Python developer with no Java experience"))
        self.assertIn("SQL", recognize_skills("Delivered SQL reports without errors"))
        self.assertNotIn("Docker", recognize_skills("Never used Docker"))
        self.assertNotIn("Java", recognize_skills("I am not interested in Java"))

    def test_blind_screening_removes_file_identifier(self) -> None:
        results = blind_screen_results(
            [{"Candidate": "Jane Doe", "File": "Jane_Doe_Resume.pdf", "Match score": 80.0}]
        )
        self.assertEqual(results[0]["Candidate"], "Candidate 0001")
        self.assertNotIn("File", results[0])

    def test_creates_readable_decision_report(self) -> None:
        report = build_decision_report(
            [
                {
                    "Candidate": "Candidate 0001",
                    "Match score": 82.0,
                    "Must-have status": "All must-haves met",
                    "Matched skills": "Python, SQL",
                    "Missing must-haves": "—",
                }
            ],
            "Data analyst with Python and SQL.",
            ["Python", "SQL"],
        )
        self.assertTrue(report.startswith(b"%PDF"))
        text = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(report)).pages)
        self.assertIn("Decision Report", text)
        self.assertIn("Candidate 0001", text)

    def test_ranks_pdf_files_with_category_and_score(self) -> None:
        project_root = Path(__file__).resolve().parents[1]
        sample = project_root / "data" / "Sample_Resume.pdf"
        results, errors = rank_pdf_resumes([sample], "Python data analysis and SQL")
        self.assertFalse(errors)
        self.assertEqual(len(results), 1)
        self.assertIn("Match score", results[0])
        self.assertIn("Skill coverage", results[0])
        self.assertIn("Score calculation", results[0])
        self.assertIn("Matched skills", results[0])
        self.assertIn("Missing skills", results[0])
        self.assertEqual(results[0]["Must-have status"], "No must-haves selected")

    def test_finds_dataset_pdfs(self) -> None:
        project_root = Path(__file__).resolve().parents[1]
        archive_directory = project_root / "data" / "archive"
        if not archive_directory.is_dir():
            self.skipTest("Optional local archive dataset is not available.")
        paths = discover_dataset_resumes(archive_directory, limit=1)
        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0].suffix.lower(), ".pdf")

    def test_ranks_structured_candidates_and_keeps_evidence(self) -> None:
        candidates = [
            {
                "candidate_id": "Candidate 0001",
                "primary_role": "Data Analyst Intern",
                "skills": ["Python", "SQL", "Tableau"],
                "text": "Python SQL Tableau data analytics internship",
                "internships": ["Data Analyst Internship"],
                "certifications": ["SQL Certificate"],
                "achievements": ["Hackathon finalist"],
            }
        ]
        results = rank_structured_resumes(
            candidates,
            "Data analyst with Python and SQL",
            must_have_skills=["Python", "SQL", "Statistics"],
        )
        self.assertEqual(results[0]["Candidate"], "Candidate 0001")
        self.assertIn("Python", results[0]["Matched skills"])
        self.assertEqual(results[0]["Achievements"], "Hackathon finalist")
        self.assertIn("Text similarity", results[0])
        self.assertEqual(
            results[0]["Score calculation"],
            "65% skills + 20% keywords + 15% text similarity",
        )
        self.assertEqual(results[0]["Must-have status"], "Review required")
        self.assertEqual(results[0]["Missing must-haves"], "Statistics")
        self.assertGreaterEqual(results[0]["Match score"], 85)

    def test_structured_skill_list_cannot_override_negated_text(self) -> None:
        results = rank_structured_resumes(
            [
                {
                    "candidate_id": "Candidate 0001",
                    "skills": ["Python"],
                    "text": "Data analyst with no Python experience.",
                }
            ],
            "Data analyst with Python",
            must_have_skills=["Python"],
        )
        self.assertEqual(results[0]["Matched skills"], "—")
        self.assertEqual(results[0]["Missing must-haves"], "Python")

    def test_score_contributions_add_up_to_match_score(self) -> None:
        results = rank_structured_resumes(
            [{"candidate_id": "Candidate 0001", "text": "Python SQL analyst with statistics"}],
            "Data analyst with Python and SQL",
        )
        parts = score_contributions(results[0], has_required_skills=True)
        self.assertEqual(set(parts), {"Skill coverage", "Keyword coverage", "Text similarity"})
        self.assertAlmostEqual(sum(parts.values()), results[0]["Match score"], delta=0.2)
        fallback = score_contributions(results[0], has_required_skills=False)
        self.assertEqual(set(fallback), {"Keyword coverage", "Text similarity"})

if __name__ == "__main__":
    unittest.main()
