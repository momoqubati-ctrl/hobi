// Runs every check module against one context and returns the merged findings.
import * as cwv from "./cwv.mjs";
import * as js from "./js.mjs";
import * as network from "./network.mjs";
import * as api from "./api.mjs";
import * as images from "./images.mjs";
import * as fonts from "./fonts.mjs";
import * as thirdparty from "./thirdparty.mjs";
import * as runtime from "./runtime.mjs";
import * as staticChecks from "./static.mjs";

export const MODULES = [
  ["cwv", cwv],
  ["javascript", js],
  ["network", network],
  ["api", api],
  ["images", images],
  ["fonts", fonts],
  ["thirdparty", thirdparty],
  ["runtime", runtime],
  ["static", staticChecks],
];

/** Run all modules. A module that throws is reported, never fatal. */
export function runAll(ctx) {
  const findings = [];
  const errors = [];
  for (const [name, mod] of MODULES) {
    try {
      findings.push(...mod.run(ctx));
    } catch (err) {
      errors.push(`${name}: ${err?.message || err}`);
    }
  }
  return { findings, errors };
}
