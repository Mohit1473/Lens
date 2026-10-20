// Role templates used to prefill the form and to drive the automated run.
// Every description mentions skills from the matcher's catalogue, so
// must-haves are detected automatically.

export type RoleTemplate = {
  id: string;
  title: string;
  seniority: Seniority;
  location: string;
  description: string;
};

export const SENIORITIES = ["Graduate", "Junior", "Mid-level", "Senior"] as const;
export type Seniority = (typeof SENIORITIES)[number];

/** Default minimum years of experience for each seniority when the job text does not say. */
export const SENIORITY_MIN_YEARS: Record<Seniority, number | null> = {
  Graduate: null,
  Junior: 1,
  "Mid-level": 2,
  Senior: 5,
};

/** Options offered in the "Minimum experience" field (null = any). */
export const EXPERIENCE_OPTIONS: Array<number | null> = [null, 1, 2, 3, 5, 7, 10];

export const DEFAULT_LOCATION = "Sydney, NSW (hybrid)";

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "data-analyst",
    title: "Data Analyst",
    seniority: "Mid-level",
    location: DEFAULT_LOCATION,
    description:
      "We are seeking a data analyst with 2+ years of experience in Python, SQL, data visualization, statistics, and stakeholder communication. The role involves cleaning datasets, building reports, and presenting insights to business teams.",
  },
  {
    id: "bi-analyst",
    title: "Business Intelligence Analyst",
    seniority: "Mid-level",
    location: DEFAULT_LOCATION,
    description:
      "We need a business intelligence analyst who builds Power BI dashboards, writes SQL, and maintains advanced Excel models. You will gather requirements from stakeholders, track KPIs, and support project management of reporting releases.",
  },
  {
    id: "python-developer",
    title: "Python Developer",
    seniority: "Mid-level",
    location: DEFAULT_LOCATION,
    description:
      "We are hiring a Python developer to build REST APIs with Django, containerise services with Docker, and deploy to AWS. Experience with Git workflows, automated testing, and code review is expected.",
  },
  {
    id: "data-engineer",
    title: "Data Engineer",
    seniority: "Senior",
    location: DEFAULT_LOCATION,
    description:
      "We are looking for a data engineer with at least 5 years of experience to design reliable pipelines in Python and SQL, run workloads on AWS or Azure, and package jobs with Docker. You will own data quality, monitoring, and documentation.",
  },
  {
    id: "ml-engineer",
    title: "Machine Learning Engineer",
    seniority: "Senior",
    location: DEFAULT_LOCATION,
    description:
      "We need a machine learning engineer to train and ship models using Python, pandas, and NumPy, with strong statistics. You will build ML pipelines, run A/B tests on model changes, and deploy services on AWS.",
  },
];

export const DEFAULT_TEMPLATE = ROLE_TEMPLATES[0];

export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Casual", "Internship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** Special template ids. */
export const BLANK_ROLE = "blank"; // "Write my own role": start from an empty form
export const EDITED_ROLE = "custom"; // a ready-made or saved role the recruiter has changed

/** A role the recruiter wrote and saved in this browser. */
export type SavedRole = RoleTemplate & {
  employmentType: EmploymentType;
  minYears: number | null;
  extraMustHaves: string[];
  savedAt: string;
};

export function isSavedRoleId(id: string): boolean {
  return id.startsWith("mine-");
}

export function findTemplate(id: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((template) => template.id === id);
}
