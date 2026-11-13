import assert from "node:assert/strict";
import test from "node:test";
import { familyOf, locationTier } from "./classify.ts";

test("London first, then the rest of the UK", () => {
  assert.equal(locationTier(["London, United Kingdom"]), "london");
  assert.equal(locationTier(["United Kingdom, London"]), "london");
  assert.equal(locationTier(["Brighton, England"]), "uk");
  assert.equal(locationTier(["Example UK"]), "uk");
  assert.equal(locationTier(["Cambridge"]), "uk");
});

test("places with a familiar name elsewhere are not the UK", () => {
  assert.equal(locationTier(["London, Ontario, Canada"]), "abroad");
  assert.equal(locationTier(["New London, CT, USA"]), "abroad");
  assert.equal(locationTier(["Cambridge, MA, USA"]), "abroad");
});

test("a role offered in several places counts as its nearest", () => {
  assert.equal(locationTier(["Munich", "London"]), "london");
  assert.equal(locationTier(["Berlin; London"]), "london");
  assert.equal(locationTier(["Seattle", "Brighton, UK"]), "uk");
});

test("remote only helps if it could mean here", () => {
  assert.equal(locationTier(["Remote"]), "remote");
  assert.equal(locationTier(["Remote, UK"]), "uk");
  assert.equal(locationTier(["Remote - EMEA"]), "remote");
  assert.equal(locationTier(["Remote, US"]), "abroad");
  assert.equal(locationTier(["Utrecht, NL"], true), "abroad");
  assert.equal(locationTier(["Example Helsinki"], true), "abroad");
  assert.equal(locationTier(["Europe"], true), "remote");
  assert.equal(locationTier([""], true), "remote");
});

test("no place stated is unknown, not abroad", () => {
  assert.equal(locationTier([""]), "unknown");
  assert.equal(locationTier([]), "unknown");
});

test("titles land in the field they sound like", () => {
  assert.equal(familyOf("Senior Rendering Engineer"), "graphics");
  assert.equal(familyOf("Lead Technical Artist - Shaders"), "graphics");
  assert.equal(familyOf("GPU Compiler Engineer"), "gpu");
  assert.equal(familyOf("Senior HPC Engineer, GPU Compute"), "gpu");
  assert.equal(familyOf("Research Engineer - 3D World Models"), "vision");
  assert.equal(familyOf("Machine Learning Engineer"), "ml");
  assert.equal(familyOf("Simulation Software Engineer"), "simulation");
  assert.equal(familyOf("Senior Gameplay Engineer"), "games");
  assert.equal(familyOf("Research Software Engineer"), "research");
  assert.equal(familyOf("Full Stack Software Engineer"), "software");
});

test("roles that are not engineering stay out, however technical they sound", () => {
  for (const title of [
    "Enterprise Account Executive",
    "Site Engineer - El Paso",
    "Mechanical Design Engineer",
    "Enterprise AI Product Owner",
    "AI transformation lead",
    "Research Communications Lead",
    "Engineering Manager, Compute",
    "Lead Vehicle Artist",
    "Senior Security Engineer",
    "Software Engineer, Quality Engineering",
    "Solutions Engineer",
    "Senior Scientist (DMPK)",
  ]) {
    assert.equal(familyOf(title), null, title);
  }
});
