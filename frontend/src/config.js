// src/config.js
//
// Single source of truth for the platform's display name. Override at build
// time with VITE_APP_NAME (e.g. on Vercel) to rebrand without code changes;
// defaults to "MangoDoe".

export const APP_NAME = import.meta.env.VITE_APP_NAME || "MangoDoe";
export const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE || "Ripe Insights | Real Results";

// Project lifecycle stages (visible status tracker).
export const STAGES = [
  { key: "lead", label: "Lead" },
  { key: "preconstruction", label: "Preconstruction" },
  { key: "mobilization", label: "Mobilization" },
  { key: "construction", label: "Construction" },
  { key: "substantial_completion", label: "Substantial Completion" },
  { key: "closeout", label: "Closeout" },
  { key: "complete", label: "Complete" },
];
export const stageLabel = (key) => (STAGES.find((s) => s.key === key) || { label: key || "Lead" }).label;
export const stageIndex = (key) => Math.max(0, STAGES.findIndex((s) => s.key === key));

// ---- Project tab organization ----
// Tabs are grouped into consistent buckets (same on every project — nothing is
// ever hidden by stage). The current stage only HIGHLIGHTS the most relevant
// tabs, so live records are never orphaned behind a hidden tab.
// Future modules slot in here: Billing -> "cost", Punch List/Reports -> "field".
export const TAB_GROUPS = [
  { key: "overview",  label: "Overview",  tabs: ["timeline", "tasks", "phases", "team", "trash"] },
  { key: "documents", label: "Documents", tabs: ["documents"] },
  { key: "cost",      label: "Cost",      tabs: ["budget", "changeorders"] },
  { key: "field",     label: "Field",     tabs: ["dailylogs", "rfis", "submittals"] },
];

export const TAB_LABELS = {
  timeline: "Timeline",
  tasks: "Tasks",
  phases: "Schedule",
  team: "Team",
  documents: "Documents",
  budget: "Budget",
  changeorders: "Change Orders",
  dailylogs: "Daily Logs",
  rfis: "RFIs",
  submittals: "Submittals",
  trash: "Deleted Items",
};

// Which tabs are most relevant at each stage (highlight only — never hides).
export const STAGE_RELEVANT_TABS = {
  lead: ["timeline", "tasks", "team", "documents"],
  preconstruction: ["phases", "budget", "rfis", "submittals", "documents"],
  mobilization: ["phases", "team", "submittals", "documents"],
  construction: ["dailylogs", "rfis", "submittals", "changeorders", "budget"],
  substantial_completion: ["changeorders", "budget", "documents", "dailylogs"],
  closeout: ["documents", "budget", "changeorders"],
  complete: ["documents", "budget"],
};
export const isStageRelevant = (stage, tabKey) =>
  (STAGE_RELEVANT_TABS[stage || "lead"] || []).includes(tabKey);
