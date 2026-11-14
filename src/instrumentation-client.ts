import { recordNavigation, sendErrorReport, startBreadcrumbs } from "./lib/errors/browser";

// Errors nothing else caught in the browser go to the error tracker, which the
// factory turns into bug issues (docs/FACTORY.md), with the last few things
// that happened before them (breadcrumbs). Errors that reach an error page are
// reported from there (src/app/error.tsx).
startBreadcrumbs();
window.addEventListener("error", (event) => sendErrorReport(event.error ?? event.message, "uncaught"));
window.addEventListener("unhandledrejection", (event) => sendErrorReport(event.reason, "rejection"));

/** Each App Router navigation becomes a breadcrumb. */
export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse") {
  recordNavigation(url, navigationType);
}
