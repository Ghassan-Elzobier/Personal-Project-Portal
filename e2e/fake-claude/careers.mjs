// Reading an employer's careers page (src/lib/jobs/careers-read.ts). It serves a made-up
// careers page at /careers/<name>, with a graphics role, a role outside the owner's
// fields and the usual menus, and answers as Claude would: one role for each link to a
// job, named by its number in the page's list (e2e/state-jobs-careers-page.spec.ts).

export const matches = (body) => "is_careers_page" in (body.output_config?.format?.schema?.properties ?? {});

export function page(path) {
  const name = /^\/careers\/([a-z0-9-]{1,40})$/.exec(path)?.[1];
  if (!name) return undefined;
  return `<!doctype html><html><head><title>Careers</title></head><body>
  <header><nav><a href="/">Home</a> <a href="/about">About us</a></nav></header>
  <main>
    <h1>Careers at Example Studio</h1>
    <p>We build tools for artists and engineers who make real-time graphics. We are a small team in London and we
    hire for curiosity and care. These are the roles we are hiring for right now.</p>
    <ul>
      <li><a href="/careers/${name}/jobs/1">Graphics Engineer ${name}</a> London, UK (hybrid)</li>
      <li><a href="/careers/${name}/jobs/2">Office Manager ${name}</a> London, UK</li>
    </ul>
    <p><a href="/blog">Read our blog</a></p>
  </main>
  <footer>Cookies and privacy</footer>
</body></html>`;
}

export function answer(user) {
  const block = /<links>\n([\s\S]*?)\n<\/links>/.exec(user)?.[1] ?? "";
  const roles = block
    .split("\n")
    .map((line) => /^L(\d+)\| (.*) — (\S+)$/.exec(line))
    .filter((m) => m && /\/jobs\/\d+$/.test(m[3]))
    .map((m) => ({ title: m[2], location: "London, UK (hybrid)", link: Number(m[1]) }));
  return { is_careers_page: true, roles };
}
