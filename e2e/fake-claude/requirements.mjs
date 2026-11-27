// Reading an advert's requirements where the rules can't (src/lib/jobs/ai-requirements.ts).
// It serves the made-up advert behind each role on a made-up careers page, at
// /careers/<name>/jobs/<n>: written as prose, with no headings for the rules to go by,
// and with the page's own job data. It answers as Claude would, quoting the advert:
// Vulkan and C++ required, CUDA a bonus (e2e/state-jobs-read-advert.spec.ts).

const PROSE = [
  "Example Studio makes tools for artists who work in real time, and we are growing our rendering team in London.",
  "You will build the renderer behind our editor, side by side with the artists who use it every day.",
  "You have shipped a real-time renderer in Vulkan and you write modern C++ every day.",
  "Experience with CUDA would be a bonus.",
  "We offer a good salary, a pension, flexible hours and a small team that cares a great deal about its craft.",
].join(" ");

export const matches = (body) => {
  const items = body.output_config?.format?.schema?.properties?.requirements?.items;
  return Boolean(items?.properties?.skill);
};

export function page(path) {
  const m = /^\/careers\/([a-z0-9-]{1,40})\/jobs\/(\d{1,3})$/.exec(path);
  if (!m) return undefined;
  const posting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: `Graphics Engineer ${m[1]}`,
    hiringOrganization: { "@type": "Organization", name: `Example Studio ${m[1]}` },
    jobLocation: { "@type": "Place", address: { addressLocality: "London", addressCountry: "GB" } },
    description: `<p>${PROSE}</p>`,
  };
  return `<!doctype html><html><head><title>Graphics Engineer</title>
  <script type="application/ld+json">${JSON.stringify(posting)}</script></head>
  <body><main><h1>Graphics Engineer</h1><p>${PROSE}</p></main></body></html>`;
}

export function answer(user) {
  const advert = /<advert>\n([\s\S]*)\n<\/advert>/.exec(user)?.[1] ?? "";
  const sentences = advert.split(/(?<=\.)\s+|\n/).filter(Boolean);
  const quote = (word) => sentences.find((s) => s.includes(word));
  const requirements = [];
  if (quote("Vulkan")) requirements.push({ skill: "vulkan", level: "required", quote: quote("Vulkan"), group: 1 });
  if (quote("C++")) requirements.push({ skill: "cpp", level: "required", quote: quote("C++"), group: 2 });
  if (quote("CUDA")) requirements.push({ skill: "cuda", level: "preferred", quote: quote("CUDA"), group: 3 });
  return { requirements };
}
