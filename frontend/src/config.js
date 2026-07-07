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
