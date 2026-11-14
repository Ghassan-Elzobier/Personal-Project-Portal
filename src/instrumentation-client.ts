import { sendErrorReport } from "./lib/errors/browser";

// Errors nothing else caught in the browser go to the error tracker, which the
// factory turns into bug issues (docs/FACTORY.md). Errors that reach an error
// page are reported from there (src/app/error.tsx).
window.addEventListener("error", (event) => sendErrorReport(event.error ?? event.message, "uncaught"));
window.addEventListener("unhandledrejection", (event) => sendErrorReport(event.reason, "rejection"));
