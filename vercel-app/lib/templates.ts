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

export const DEFAULT_LOCATION = "Sydney, NSW (hybrid)";

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "data-analyst",
    title: "Data Analyst",
    seniority: "Mid-level",
    location: DEFAULT_LOCATION,
    description:
      "We are seeking a data analyst with experience in Python, SQL, data visualization, statistics, and stakeholder communication. The role involves cleaning datasets, building reports, and presenting insights to business teams.",
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
      "We are looking for a data engineer to design reliable pipelines in Python and SQL, run workloads on AWS or Azure, and package jobs with Docker. You will own data quality, monitoring, and documentation.",
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

export function findTemplate(id: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((template) => template.id === id);
}
