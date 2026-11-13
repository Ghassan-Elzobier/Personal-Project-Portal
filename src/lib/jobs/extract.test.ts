import assert from "node:assert/strict";
import test from "node:test";
import { advertText, extractRequirements, headingSection, seniorityOf } from "./extract.ts";

const levels = (text: string) =>
  Object.fromEntries(extractRequirements(text).requirements.map((r) => [r.skill, r.level]));
const groupOf = (text: string, skill: string) =>
  extractRequirements(text).requirements.find((r) => r.skill === skill)?.group;

test("advert HTML becomes the lines a reader sees", () => {
  const text = advertText("<h2>Requirements</h2><ul><li>C++ &amp; Python</li><li>Vulkan</li></ul><p>Thanks</p>");
  assert.deepEqual(text.split("\n").filter(Boolean), ["Requirements", "- C++ & Python", "- Vulkan", "Thanks"]);
});

test("HTML that a feed escaped is unescaped first", () => {
  assert.equal(advertText("&lt;p&gt;Rust &amp;amp; Go&lt;/p&gt;"), "Rust & Go");
});

test("text a reader cannot see does not count", () => {
  const raw = `<p>Vulkan</p><span style="display:none">Python</span><div hidden>Rust</div><!-- CUDA --><script>x("Metal")</script><p>Uni​ty</p>`;
  const text = advertText(raw);
  for (const word of ["Python", "Rust", "CUDA", "Metal"]) assert.ok(!text.includes(word), word);
  assert.ok(text.includes("Vulkan"));
  assert.ok(text.includes("Unity"), "zero-width characters are removed");
});

test("headings are told apart from sentences", () => {
  assert.equal(headingSection("Essential Skills, Attributes and Experience"), "required");
  assert.equal(headingSection("Highly Desirable"), "preferred");
  assert.equal(headingSection("What you'll be doing"), "responsibility");
  assert.equal(headingSection("About the Advanced Technology Group"), "about");
  assert.equal(headingSection("About you"), "required");
  assert.equal(headingSection("What we are looking for"), "required");
  assert.equal(headingSection("Why Sony Interactive Entertainment?"), "about");
  assert.equal(headingSection("- Experience with C++"), null);
  assert.equal(headingSection("You will work with a talented team on our renderer every day of the week."), null);
});

test("a skill takes its level from the section it sits in", () => {
  const found = levels(
    ["Responsibilities", "- Write Vulkan code", "Requirements", "- Strong C++", "Nice to have", "- Rust"].join("\n"),
  );
  assert.deepEqual(found, { vulkan: "responsibility", cpp: "required", rust: "preferred" });
});

test("company talk before the first heading is ignored when the advert has headings", () => {
  assert.deepEqual(levels(["We build Vulkan tools for everyone.", "Requirements", "- C++"].join("\n")), {
    cpp: "required",
  });
});

test("an advert with no headings is read as unstated, not as required", () => {
  assert.deepEqual(levels("You will write C++ and Python."), { cpp: "unstated", python: "unstated" });
});

test("an advert listing only duties still says what the job takes", () => {
  assert.deepEqual(levels(["Responsibilities", "- Write C++"].join("\n")), { cpp: "unstated" });
});

test("a clause softened in a required section counts as wanted, not required", () => {
  const found = levels(
    [
      "Key Qualifications",
      "- Understanding of meshes; knowledge in 3D Gaussian Splatting is a nice to have.",
      "- Vulkan is not required",
    ].join("\n"),
  );
  assert.equal(found.geometry, "required");
  assert.equal(found["gaussian-splatting"], "preferred");
  assert.equal(found.vulkan, "preferred");
});

test("degree subjects are not skills", () => {
  const found = levels(
    ["Requirements", "- Bachelor's degree in computer science, machine learning or computer vision", "- PyTorch"].join(
      "\n",
    ),
  );
  assert.deepEqual(found, { pytorch: "required" });
});

test("alternatives share a group, and separate needs do not", () => {
  const either = ["Requirements", "- Proficiency in Blender, Unity, Unreal Engine, or similar"].join("\n");
  assert.equal(groupOf(either, "blender"), groupOf(either, "unity"));
  assert.equal(groupOf(either, "unity"), groupOf(either, "unreal"));

  const both = ["Requirements", "- Strong C++ and Python"].join("\n");
  assert.notEqual(groupOf(both, "cpp"), groupOf(both, "python"));

  const mixed = ["Requirements", "- Experience with C++ and Vulkan or Direct3D"].join("\n");
  assert.notEqual(groupOf(mixed, "cpp"), groupOf(mixed, "vulkan"));
  assert.equal(groupOf(mixed, "vulkan"), groupOf(mixed, "d3d12"));

  const examples = ["Requirements", "- Proficiency in Python and frameworks such as PyTorch or TensorFlow"].join("\n");
  assert.notEqual(groupOf(examples, "python"), groupOf(examples, "pytorch"));
  assert.equal(groupOf(examples, "pytorch"), groupOf(examples, "tensorflow"));
});

test("every requirement quotes the advert it came from", () => {
  const text = ["Requirements", "- Strong C++ in large codebases"].join("\n");
  const [requirement] = extractRequirements(text).requirements;
  assert.ok(text.includes(requirement.quote));
});

test("years, clearance, sponsorship and early-career notes are picked up", () => {
  const { details } = extractRequirements(
    [
      "Requirements",
      "- 5+ years of C++ experience",
      "- You must hold SC clearance or be clearable",
      "We are unable to sponsor visas.",
      "Open to early-career engineers",
    ].join("\n"),
  );
  assert.equal(details.years, 5);
  assert.equal(details.clearance, true);
  assert.equal(details.noSponsorship, true);
  assert.equal(details.earlyCareer, true);
});

test("unknown terms surface what the skill list does not know", () => {
  const { details } = extractRequirements(["Requirements", "- Experience with Kubeflow and JUnit and AWS"].join("\n"));
  assert.ok(details.unknownTerms?.includes("JUnit"));
  assert.ok(!details.unknownTerms?.includes("AWS"), "common or known terms stay out");
});

test("level comes from the title", () => {
  assert.equal(seniorityOf("Senior Rendering Engineer"), "senior");
  assert.equal(seniorityOf("Senior/Staff Software Engineer - Rendering API"), "lead");
  assert.equal(seniorityOf("Principal Graphics Software Architect"), "lead");
  assert.equal(seniorityOf("Graduate Software Engineer"), "junior");
  assert.equal(seniorityOf("PhD Research Intern, 3D World Models"), "intern");
  assert.equal(seniorityOf("Software Development Engineer II, 3D Graphics"), "mid");
  assert.equal(seniorityOf("Rendering Engineer"), "any");
  assert.equal(seniorityOf("Research Engineer", "This role is ideal for early-career engineers"), "junior");
});
