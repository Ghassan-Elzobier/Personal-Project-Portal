import "server-only";
import { RENDERER } from "./guide";

// Whether the renderer has moved on since the Lab was drawn: commits on its main
// branch after the pinned one that touch the files the figures explain. The
// Lab shows a banner when they do, so stale figures are loud, not silent.

const WATCHED = ["src/main.cpp", "shaders/raytrace.comp", "CMakeLists.txt"];
const REPO = RENDERER.repo.replace("https://github.com/", "");

export type Drift = { commits: number; files: string[]; url: string };

export async function rendererDrift(branch = "main"): Promise<Drift | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/compare/${RENDERER.commit}...${branch}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "personal-project-portal" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ahead_by: number; html_url: string; files?: { filename: string }[] };
    const files = (body.files ?? []).map((f) => f.filename).filter((f) => WATCHED.includes(f));
    return body.ahead_by > 0 && files.length ? { commits: body.ahead_by, files, url: body.html_url } : null;
  } catch {
    return null;
  }
}
