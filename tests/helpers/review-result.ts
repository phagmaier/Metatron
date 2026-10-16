export const passReview = {
  summary: "Fixture review: candidate and surrounding code inspected",
  recommendation: "pass",
  findings: [],
  tests: [
    { command: "Tests unavailable: shell is disabled", result: "not_run" },
  ],
} as const;

export const findingsReview = {
  ...passReview,
  summary: "Fixture review: README loses the project heading",
  recommendation: "changes_requested",
  findings: [
    {
      severity: "important",
      file: "README.md",
      line: 1,
      justification:
        "Restore the project heading so readers can identify the project.",
      evidence:
        "The candidate replaces the heading with 'Protocol fixture result'.",
      confidence: 0.95,
    },
  ],
} as const;
