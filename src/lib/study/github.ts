import "server-only";

// Recent commits from the renderer's public repo, so a benchmark can be tied to
// one by picking it. If GitHub cannot be reached you can still type the hash.

const REPO = "Ghassan-Elzobier/Vulkan-Renderer";

export type RepoCommit = { sha: string; message: string; date: string; url: string };

export function commitUrl(sha: string): string {
  return `https://github.com/${REPO}/commit/${sha}`;
}

export async function recentCommits(): Promise<RepoCommit[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits?per_page=10`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "personal-project-portal" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as { sha: string; html_url: string; commit: { message: string; author: { date: string } } }[];
    return rows.map((c) => ({ sha: c.sha, message: c.commit.message.split("\n")[0], date: c.commit.author.date, url: c.html_url }));
  } catch {
    return [];
  }
}
