// src/config.js
//
// Single source of truth for the platform's display name. Override at build
// time with VITE_APP_NAME (e.g. on Vercel) to rebrand without code changes;
// defaults to "MangoDoe".

export const APP_NAME = import.meta.env.VITE_APP_NAME || "MangoDoe";
export const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE || "Ripe Insights | Real Results";

// Project lifecycle stages (visible status tracker). Same underlying keys
// across every vertical — the backend validates project.stage against a
// fixed whitelist (routes/projects.js STAGE_KEYS), so these are relabeled
// per vertical here rather than given different stored values, the same
// "same shape, relabeled" pattern used for roles (ROLE_LABELS_BY_VERTICAL
// in DashboardLayout.jsx) and nav (NavForVertical).
export const STAGES_BY_VERTICAL = {
  construction: [
    { key: "lead", label: "Lead" },
    { key: "preconstruction", label: "Preconstruction" },
    { key: "mobilization", label: "Mobilization" },
    { key: "construction", label: "Construction" },
    { key: "substantial_completion", label: "Substantial Completion" },
    { key: "closeout", label: "Closeout" },
    { key: "complete", label: "Complete" },
  ],
  projects: [
    { key: "lead", label: "Lead" },
    { key: "preconstruction", label: "Kickoff" },
    { key: "mobilization", label: "Planning" },
    { key: "construction", label: "In Progress" },
    { key: "substantial_completion", label: "Review" },
    { key: "closeout", label: "Delivery" },
    { key: "complete", label: "Closed" },
  ],
};
// Construction is the default/fallback — matches every other vertical
// fallback throughout the app (org.vertical defaults to 'construction').
export const STAGES = STAGES_BY_VERTICAL.construction;
export const stagesForVertical = (vertical) => STAGES_BY_VERTICAL[vertical] || STAGES_BY_VERTICAL.construction;
export const stageLabel = (key, vertical) =>
  (stagesForVertical(vertical).find((s) => s.key === key) || { label: key || "Lead" }).label;
export const stageIndex = (key, vertical) =>
  Math.max(0, stagesForVertical(vertical).findIndex((s) => s.key === key));

// Same 4-tier role shape everywhere, relabeled per vertical (design doc
// Section 2) — the stored role value never changes, just what it's called
// on screen. Keyed by vertical so this is a lookup, not a chain of
// booleans. Shared across DashboardLayout.jsx (sidebar role label) and
// ProjectDetailPage.jsx (add-team-member dropdown) so there's one source
// of truth instead of the same mapping drifting apart in two places.
export const ROLE_LABELS_BY_VERTICAL = {
  construction: { admin: "Administrator", staff: "RADAH Staff", client: "Client / Owner", trade_partner: "Trade Partner" },
  facilities: { admin: "Administrator", staff: "Facilities Staff", client: "Tenant", trade_partner: "Vendor" },
  projects: { admin: "Administrator", staff: "Team Member", client: "Stakeholder", trade_partner: "Contributor" },
};
export const roleLabelsForVertical = (vertical) => ROLE_LABELS_BY_VERTICAL[vertical] || ROLE_LABELS_BY_VERTICAL.construction;

// Project-membership role (Owner Contact / Project Manager / Trade Partner / Viewer)
// — different from platform role above (admin/staff/client/trade_partner).
// Same "same shape, relabeled" pattern, used in ProjectDetailPage.jsx's
// add-team-member dropdown.
export const MEMBERSHIP_ROLE_LABELS_BY_VERTICAL = {
  construction: { owner_contact: "Owner Contact", project_manager: "Project Manager", trade_partner: "Trade Partner", viewer: "Viewer" },
  facilities:   { owner_contact: "Tenant Contact", project_manager: "Facilities Manager", trade_partner: "Vendor", viewer: "Viewer" },
  projects:     { owner_contact: "Stakeholder Contact", project_manager: "Project Manager", trade_partner: "Contributor", viewer: "Viewer" },
};
export const membershipRoleLabelsForVertical = (vertical) => MEMBERSHIP_ROLE_LABELS_BY_VERTICAL[vertical] || MEMBERSHIP_ROLE_LABELS_BY_VERTICAL.construction;

// ---- Project tab organization ----
// Tabs are grouped into consistent buckets (same on every project — nothing is
// ever hidden by stage). The current stage only HIGHLIGHTS the most relevant
// tabs, so live records are never orphaned behind a hidden tab.
// Future modules slot in here: Billing -> "cost", Punch List/Reports -> "field".
export const TAB_GROUPS = [
  { key: "overview",  label: "Overview",  tabs: ["timeline", "tasks", "phases", "team", "approvals", "logs", "trash"] },
  { key: "documents", label: "Documents", tabs: ["documents"] },
  { key: "cost",      label: "Cost",      tabs: ["budget", "changeorders", "billing", "timetracking"] },
  { key: "field",     label: "Field",     tabs: ["dailylogs", "rfis", "submittals"] },
  { key: "reports",   label: "Reports",   tabs: ["reports"] },
];

export const TAB_LABELS = {
  timeline: "Timeline",
  tasks: "Tasks",
  phases: "Schedule",
  team: "Team",
  approvals: "Approvals",
  documents: "Documents",
  budget: "Budget",
  changeorders: "Change Orders",
  billing: "Billing",
  timetracking: "Time Tracking",
  dailylogs: "Daily Logs",
  rfis: "RFIs",
  submittals: "Submittals",
  logs: "Logs",
  trash: "Deleted Items",
  reports: "Reports",
};

// Which tabs are most relevant at each stage (highlight only — never hides).
// Two separate maps because the tabs that exist at all differ by vertical
// (a Projects org has no rfis/billing/dailylogs to ever highlight).
export const STAGE_RELEVANT_TABS_BY_VERTICAL = {
  construction: {
    lead: ["timeline", "tasks", "team", "documents"],
    // "logs" is relevant once work is planned and running
    preconstruction: ["logs", "phases", "budget", "rfis", "submittals", "documents"],
    mobilization: ["logs", "phases", "team", "submittals", "documents"],
    construction: ["logs", "dailylogs", "rfis", "submittals", "changeorders", "budget", "billing"],
    substantial_completion: ["logs", "changeorders", "budget", "billing", "documents", "dailylogs"],
    closeout: ["logs", "documents", "budget", "changeorders", "billing", "reports"],
    complete: ["documents", "budget", "reports"],
  },
  projects: {
    lead: ["timeline", "tasks", "team", "documents"],
    preconstruction: ["tasks", "phases", "team", "documents", "approvals"],
    mobilization: ["tasks", "phases", "budget", "timetracking", "documents"],
    construction: ["tasks", "phases", "timetracking", "approvals", "budget"],
    substantial_completion: ["approvals", "timetracking", "budget", "documents"],
    closeout: ["documents", "budget", "reports", "approvals"],
    complete: ["documents", "budget", "reports"],
  },
};
export const STAGE_RELEVANT_TABS = STAGE_RELEVANT_TABS_BY_VERTICAL.construction;
export const isStageRelevant = (stage, tabKey, vertical) => {
  const map = STAGE_RELEVANT_TABS_BY_VERTICAL[vertical] || STAGE_RELEVANT_TABS_BY_VERTICAL.construction;
  return (map[stage || "lead"] || []).includes(tabKey);
};
