// Reading one advert (src/lib/jobs/ai-read.ts). It reads a made-up advert's "Role:",
// "Employer:", "Location:", "Salary:" and "Closing date:" lines the way Claude would,
// and names every line as the advert except the site's menus, cookie notice and other
// jobs (e2e/state-jobs-add-from-advert.spec.ts).

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const NOT_THE_ADVERT = /^(?:home\b|we use cookies|similar jobs)/i;

/** "30 November 2026" or "2026-11-30" as YYYY-MM-DD. */
function dayOf(text) {
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1];
  const m = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/i.exec(text);
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  return month < 0 ? "" : `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** The numbered lines inside a request's <advert> block. */
export function numberedLines(user) {
  const block = /<advert>\n([\s\S]*)\n<\/advert>/.exec(user)?.[1] ?? "";
  return block.split("\n").map((l) => {
    const m = /^(\d+)\| ?(.*)$/.exec(l);
    return { n: Number(m?.[1] ?? 0), text: m?.[2] ?? "" };
  });
}

export const matches = (body) => "advert_lines" in (body.output_config?.format?.schema?.properties ?? {});

export function answer(user) {
  const lines = numberedLines(user);
  const value = (label) =>
    lines
      .find((l) => l.text.toLowerCase().startsWith(`${label.toLowerCase()}:`))
      ?.text.slice(label.length + 1)
      .trim() ?? "";
  const title = value("Role");
  return {
    is_job_advert: title !== "",
    title,
    employer: value("Employer"),
    location: value("Location"),
    salary: value("Salary"),
    closing_date: dayOf(value("Closing date")),
    advert_lines: lines.filter((l) => l.n > 0 && !NOT_THE_ADVERT.test(l.text)).map((l) => ({ first: l.n, last: l.n })),
  };
}
