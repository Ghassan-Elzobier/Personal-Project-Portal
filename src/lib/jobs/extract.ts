// Reads an advert with rules, not a model. It finds the sections, sees which skills
// each line mentions and keeps that line as the quote, so every requirement can be
// checked against the advert by eye, and advert text cannot give anything orders.
//
// Change EXTRACT_VERSION when these rules change: the next refresh re-reads every
// advert already stored, without asking the feeds again.

import { findSkills } from "./skills.ts";

export const EXTRACT_VERSION = 1;

export type RequirementLevel = "required" | "preferred" | "responsibility" | "unstated";
export type Seniority = "intern" | "junior" | "any" | "mid" | "senior" | "lead";

export type Requirement = {
  skill: string;
  level: RequirementLevel;
  quote: string;
  /** Requirements in the same group are alternatives: any one of them will do. */
  group: number;
};

export type Details = {
  years?: number;
  clearance?: boolean;
  noSponsorship?: boolean;
  earlyCareer?: boolean;
  /** Capitalised terms in the requirements that are not on the skill list. */
  unknownTerms?: string[];
};

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", pound: "£", euro: "€",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const HIDDEN = /<(\w+)\b[^>]*(?:\shidden(?=[\s/>=])|aria-hidden=["']?true|style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'])[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** An advert's HTML as the plain lines a reader would see, with hidden text gone. */
export function advertText(raw: string): string {
  // Some feeds escape their HTML, and some escape it twice.
  let html = raw;
  for (let i = 0; i < 2 && /&lt;\/?[a-z]/i.test(html); i++) html = decodeEntities(html);
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(HIDDEN, " ")
      .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<\/?(?:p|div|h[1-6]|ul|ol|li|tr|section|blockquote|table|article|header|footer)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[​-‏⁠﻿­]/g, "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim()
    .slice(0, 60000);
}

type Section = RequirementLevel | "about" | "intro";

const PREFERRED_HEADING = /nice[- ]to[- ]haves?|\bbonus\b|desirable|\bpreferred\b|good to have|would be (?:nice|great|a plus)|\bplus(?:es)?\b|extra credit|stand out|advantageous|desired/;
const REQUIRED_HEADING = /about you\b|who you are|what you(?:'|’)?(?:ll| will)? (?:need|bring|have)|what (?:we|you)(?:'|’)?(?:re| are)? looking for|what we(?:'|’)?(?:re| are)? (?:need|look|seek)|what we value|looking for|you(?:'|’)?(?:ll| will)? (?:have|bring|need)|you (?:should|must|may) have|you have\b|you bring|expect (?:you|from you)|we expect|required|requirements?|essential|must[- ]haves?|qualifications?|what it takes|what makes you|your (?:background|profile|experience|skills)|ideal (?:candidate|profile)|minimum|key skills|competenc|skills (?:and|&) experience/;
const ROLE_HEADING = /responsibilit|what you(?:'|’)?(?:ll| will) (?:do|be doing|work on)|the role|your role|job summary|role (?:overview|summary|description)|duties|day[- ]to[- ]day|in this role|the job|^overview|the opportunity|the position|your mission|job description/;
const ABOUT_HEADING = /about\b|who we are|why (?:join|us|work|\w)|what we offer|benefits|perks|compensation|equal opportunit|our (?:mission|values|culture|team|story|company)|diversity|life at|how to apply|interview|hiring process|the team|salary|additional information|privacy|disclaimer|what(?:'|’)?s in it for you|we offer|reward|notice/;
const SKILLS_HEADING = /\bskills\b|\bexperience\b|technical/;

/** Which section a line opens, if it reads as a heading rather than a sentence. */
export function headingSection(line: string): Section | null {
  if (/^[-•*]\s/.test(line) || line.length > 80 || line.split(/\s+/).length > 10) return null;
  if (/[.;,]$/.test(line)) return null;
  const text = line.toLowerCase().replace(/[:!?]+$/, "").trim();
  if (PREFERRED_HEADING.test(text)) return "preferred";
  if (REQUIRED_HEADING.test(text)) return "required";
  if (ROLE_HEADING.test(text)) return "responsibility";
  if (ABOUT_HEADING.test(text)) return "about";
  if (SKILLS_HEADING.test(text)) return "required";
  return null;
}

/** Degree subjects are not skills: "a degree in computer vision" asks for a degree. */
const DEGREE_LINE = /\b(?:degree|bachelor(?:'|’)?s?|master(?:'|’)?s|ph\.?d|b\.?sc|m\.?sc|b\.?eng|m\.?eng|undergraduate|postgraduate)\b/i;

const SOFTENED = /nice[- ]to[- ]have|\ba plus\b|\bbonus\b|desirable|\bpreferred\b|advantageous|not (?:required|essential|necessary)|\bideally\b|would be (?:great|nice|beneficial|good)|is beneficial|helpful\b|familiarity with .* (?:a plus|helpful)/i;
const ALTERNATIVE = /\bor\b|\bor similar\b|\bor equivalent\b/i;
const LIST_MARKER = /\b(?:such as|e\.g\.?|for example|like|including|one of|any of)\b/i;

const RANK: Record<RequirementLevel, number> = { required: 3, unstated: 2, preferred: 1, responsibility: 0 };

// Words that open sentences or name no technology, for the list of unknown terms.
const COMMON = new Set(
  "ML CI CD GPU CPU UK US USA EU CV IT QA SDLC DevOps MS BS BA MA CA WA NY NYC SECRET ISO KPIs SOPs SaaS SDKs SDK HR AWS GCP AI SOP KPI OKRs PR PRs UI UX A About Ability Able Across Advanced Agile AI All Also An And Any API APIs Are As At Be Because Bachelor Bachelors BSc Build Building But By Can Collaborate Communication Computer Degree Demonstrated Design Develop Developing Development Do Each Engineer Engineering English Ensure Equivalent Excellent Experience Experienced Familiarity Familiar For From Good Great Have Having Hands High Ideally If In Including Is It Its Knowledge Lead Leading Masters Master MSc Must New Not Of On One Or Our PhD Passion Passionate Previous Proficiency Proficient Proven Science Senior Software Solid Staff Strong Team The This To Track Understanding Use Using We Who Will With Work Working Worked Years You Your".split(" "),
);

function unknownTerms(line: string): string[] {
  // A sentence's first word is capitalised whatever it means, so skip it.
  const words = line.replace(/^[-•*]\s*/, "").split(/[\s,;:()/]+/).slice(1);
  return words
    .map((w) => w.replace(/[.!?'’"]+$/, ""))
    .filter((w) => /^(?:[A-Z][a-z]+[A-Z]\w*|[A-Z]{2,}[a-z0-9+#]*|[A-Z][a-z0-9]*[+#]+|[A-Z][a-z]+\.[a-z]+)$/.test(w) && !COMMON.has(w) && findSkills(w).length === 0);
}

/** Which skills in one line are alternatives to each other. Python and PyTorch are not. */
function groupWithin(line: string, startGroup: number): { skill: string; group: number }[] {
  const out: { skill: string; group: number }[] = [];
  let group = startGroup;
  // What follows "such as" is a list of examples, separate from what comes before it.
  const marker = line.search(LIST_MARKER);
  const pieces = marker > 0 ? [{ text: line.slice(0, marker), list: false }, { text: line.slice(marker), list: true }] : [{ text: line, list: false }];

  for (const piece of pieces) {
    const clauses = piece.list || !ALTERNATIVE.test(piece.text) ? [piece.text] : piece.text.split(/\band\b(?!\/)/i);
    for (const clause of clauses) {
      const alternatives = piece.list || ALTERNATIVE.test(clause);
      const skills = findSkills(clause);
      if (alternatives) {
        if (skills.length) group++;
        for (const s of skills) out.push({ skill: s.skill.key, group });
      } else {
        for (const s of skills) out.push({ skill: s.skill.key, group: ++group });
      }
    }
  }
  return out;
}

export function extractRequirements(text: string): { requirements: Requirement[]; details: Details } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sections: { line: string; section: Section }[] = [];
  let current: Section = "intro";
  let structured = false;
  for (const line of lines) {
    const heading = headingSection(line);
    if (heading) {
      current = heading;
      if (heading === "required" || heading === "preferred" || heading === "responsibility") structured = true;
      continue;
    }
    sections.push({ line, section: current });
  }

  const best = new Map<string, Requirement>();
  const details: Details = {};
  const unknown = new Set<string>();
  let group = 0;

  for (const { line, section } of sections) {
    if (/early[- ]career|new graduates?|recent graduates?/i.test(line) && section !== "about") details.earlyCareer = true;
    if (/security clearance|\b(?:SC|DV) clear|\bclearable\b|british (?:citizen|national)|uk nationals?\b/i.test(line)) details.clearance = true;
    if (/(?:no|not|unable to|cannot|can't|do not|don't|does not) (?:\w+ ){0,3}sponsor|without (?:\w+ )?sponsorship/i.test(line)) details.noSponsorship = true;

    // With headings, the intro is company talk. Without any, it may be all we have.
    if (section === "about" || (section === "intro" && structured)) continue;
    const base: RequirementLevel = section === "intro" ? "unstated" : section;

    for (const clause of line.split(/;|(?<=[a-z)])\.\s+(?=[A-Z])/)) {
      const trimmed = clause.replace(/^[-•*]\s*/, "").trim();
      if (!trimmed) continue;
      const level: RequirementLevel = (base === "required" || base === "unstated") && SOFTENED.test(trimmed) ? "preferred" : base;

      if (level === "required" || level === "unstated") {
        const years = /(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years/i.exec(trimmed);
        if (years && Number(years[1]) < 30) details.years = Math.max(details.years ?? 0, Number(years[1]));
        for (const t of unknownTerms(trimmed)) unknown.add(t);
      }

      if (DEGREE_LINE.test(trimmed)) continue;
      // "Work with the Robotics team" says who you meet, not what you need.
      if (base === "responsibility" && /^(?:collaborat|partner|work(?:ing)?(?: closely)? with|liaise|coordinate)/i.test(trimmed)) continue;
      const grouped = groupWithin(trimmed, group);
      for (const g of grouped) group = Math.max(group, g.group);
      for (const { skill, group: g } of grouped) {
        const existing = best.get(skill);
        if (!existing || RANK[level] > RANK[existing.level]) {
          best.set(skill, { skill, level, quote: trimmed.slice(0, 260), group: g });
        }
      }
    }
  }

  if (unknown.size) details.unknownTerms = [...unknown].slice(0, 20);
  // An advert that only lists duties still says what the job takes, so don't let it
  // look as if it asks for nothing. These read as unstated rather than required.
  const requirements = [...best.values()];
  if (!requirements.some((r) => r.level === "required" || r.level === "unstated")) {
    for (const r of requirements) if (r.level === "responsibility") r.level = "unstated";
  }
  return { requirements, details };
}

export function seniorityOf(title: string, text = ""): Seniority {
  const t = title.toLowerCase();
  if (/\b(?:intern|internship|placement|working student|apprentice)\b/.test(t)) return "intern";
  if (/\b(?:principal|staff|lead|head of|director|distinguished|vp|chief|manager|architect)\b/.test(t)) return "lead";
  if (/\b(?:senior|sr\.?|snr)\b|\biii\b|\biv\b/.test(t)) return "senior";
  if (/\b(?:graduate|grad|junior|jr\.?|entry[- ]level|early[- ]career|new grad|associate)\b/.test(t)) return "junior";
  if (/\b(?:mid|mid-level|intermediate)\b|\bii\b/.test(t)) return "mid";
  if (/early[- ]career/i.test(text)) return "junior";
  return "any";
}
