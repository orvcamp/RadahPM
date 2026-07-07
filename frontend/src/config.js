// src/config.js
//
// Single source of truth for the platform's display name. Override at build
// time with VITE_APP_NAME (e.g. on Vercel) to rebrand without code changes;
// defaults to "MangoDoe".

export const APP_NAME = import.meta.env.VITE_APP_NAME || "MangoDoe";
export const APP_TAGLINE = import.meta.env.VITE_APP_TAGLINE || "Ripe Insights | Real Results";
