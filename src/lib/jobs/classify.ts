// Where a role is and what kind of role it is, from the fields a feed gives. Location
// comes from location fields only: adverts mention London for all sorts of reasons.

export type LocationTier = "london" | "uk" | "remote" | "abroad" | "unknown";

const UK_PLACES = /\b(?:united kingdom|great britain|britain|england|scotland|wales|northern ireland|u\.?k\.?|gb|gbr|brighton|guildford|cambridge|oxford|manchester|edinburgh|bristol|leeds|dundee|newcastle|reading|milton keynes|birmingham|glasgow|belfast|cardiff|southampton|leamington(?: spa)?|horsham|farnborough|sheffield|nottingham|york|liverpool|swindon|slough|bath|warwick|exeter|leicester|coventry|hemel hempstead|sunderland|gosport|portsmouth|surrey|sussex|hampshire|berkshire|hertfordshire)\b/i;
const ABROAD_HINT = /\b(?:usa?|united states|canada|ontario|massachusetts|mass\.?|cambridge, ma|new london|texas|california|ny|new york|germany|france|poland|czech|czechia|india|china|japan|singapore|australia|netherlands|spain|portugal|ireland|sweden|finland|romania|korea|taiwan|israel|brazil|mexico)\b/i;
const REMOTE_OK = /\b(?:uk|united kingdom|europe|emea|eu|worldwide|global|anywhere)\b/i;

function tierOfOne(location: string): LocationTier {
  const text = location.trim();
  if (!text) return "unknown";
  const abroad = ABROAD_HINT.test(text);
  if (/\blondon\b/i.test(text) && !/\bnew london\b|\bontario\b|\bcanada\b/i.test(text)) return "london";
  if (UK_PLACES.test(text) && !/cambridge, ?(?:ma|massachusetts)|\b(?:usa?|united states|ontario|canada)\b/i.test(text)) return "uk";
  if (/\bremote\b|\banywhere\b|\bwork from home\b|\bhome[- ]based\b/i.test(text)) {
    return abroad && !REMOTE_OK.test(text) ? "abroad" : "remote";
  }
  return "abroad";
}

const ORDER: LocationTier[] = ["london", "uk", "remote", "abroad", "unknown"];

/** The best of a role's locations, since a role offered in Munich and London is a London role. */
export function locationTier(locations: string[], remote = false): LocationTier {
  const tiers = locations.flatMap((l) => l.split(/\s*[;|]\s*/)).map(tierOfOne);
  const best = ORDER.find((t) => tiers.includes(t)) ?? "unknown";
  // A remote flag alone says nothing about where: "remote" in Utrecht is still Utrecht.
  if (remote && best === "unknown") return "remote";
  if (remote && best === "abroad" && locations.some((l) => REMOTE_OK.test(l))) return "remote";
  return best;
}

export type Family = { key: string; name: string; test?: RegExp };

// Earlier entries win, so a "Simulation Software Engineer" is simulation, not software.
export const FAMILIES: readonly Family[] = [
  { key: "graphics", name: "Graphics and rendering", test: /graphics?\b|render|shader|vulkan|directx|technical artist|\bengine programmer|game engine|\bvfx\b|\bcgi\b/i },
  { key: "gpu", name: "GPU and high-performance computing", test: /\bgpu\b|\bhpc\b|\bcuda\b|high[- ]performance|parallel|compiler|driver|accelerat/i },
  { key: "vision", name: "Computer vision and 3D", test: /computer vision|perception|3d reconstruction|\bslam\b|3d world|geometry|\b3d\b|novel view|mapping/i },
  { key: "ml", name: "Machine learning and AI", test: /machine learning|\bml\b|\bai\b|deep learning|\bllm\b|\bnlp\b|inference|world models|applied scientist/i },
  { key: "simulation", name: "Simulation and robotics", test: /simulation|physics|modelling|modeling|digital twin|robotic/i },
  { key: "xr", name: "XR, AR and VR", test: /\bxr\b|\bar\b|\bvr\b|augmented|virtual reality|mixed reality|spatial computing/i },
  { key: "games", name: "Games engineering", test: /\bgame(?:play)?\b|\bgames\b|unreal|unity/i },
  { key: "research", name: "Research software", test: /research software|\brse\b|scientific (?:software|computing|programmer)|research (?:engineer|scientist|developer)/i },
  { key: "data", name: "Data engineering and science", test: /\bdata (?:engineer|scientist|analyst|platform|infrastructure)|analytics engineer/i },
  { key: "software", name: "Other software", test: /engineer|developer|programmer|\bdevops\b|\bsre\b|scientist|researcher|architect/i },
];

/** Roles that sound technical and are not. Checked before everything else. */
const NOT_SOFTWARE = /\b(?:sales|account (?:executive|manager|director)|recruit\w*|talent|marketing|human resources|\bhr\b|finance|financial|payroll|legal|counsel|customer success|site (?:engineer|surveyor)|surveyor|mechanical|electrical|civil|structural|construction|vehicle handling|hardware engineer|asic|fpga|manufacturing|supply chain|procurement|facilities|office|executive assistant|chef|barista|nurse|teacher|solutions? (?:engineer|architect|consultant)|sales engineer|field engineer|support engineer|go[- ]to[- ]market|social|community|content creator|copywriter|artist|animator|designer|producer|product manager|project manager|program manager|programme manager|scrum|qa tester|game tester|writer|translator|localisation|localization)\b/i;
const TECHNICAL_ARTIST = /technical artist/i;
/** Managing people, securing systems and testing products are other careers. */
const OTHER_TRACKS = /\b(?:manager|director|head of|vp|vice president|chief|security|quality (?:engineer\w*|assurance)|qa|qe|sdet|test engineer|it operations|compliance|technician|biolog\w*|chemist\w*|dmpk|pharma\w*|clinical|protein|medicinal)\b/i;
const ENGINEERING_ROLE = /engineer|developer|programmer|scientist|researcher|architect|technical artist|\bsre\b|devops|\brse\b|software/i;

export function familyOf(title: string): string | null {
  if (NOT_SOFTWARE.test(title) && !TECHNICAL_ARTIST.test(title)) return null;
  if (OTHER_TRACKS.test(title) || !ENGINEERING_ROLE.test(title)) return null;
  return FAMILIES.find((f) => f.test?.test(title))?.key ?? null;
}

export function familyName(key: string): string {
  return FAMILIES.find((f) => f.key === key)?.name ?? key;
}

/** Families worth considering a move abroad for. General software is not. */
export function isCoreFamily(key: string): boolean {
  return key !== "software" && key !== "data";
}
