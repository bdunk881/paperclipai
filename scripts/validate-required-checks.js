const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const checksPath = path.join(repoRoot, "infra", "branch-protection", "required-checks.json");
const ciWorkflowPath = path.join(repoRoot, ".github", "workflows", "ci.yml");
const promotionGatePath = path.join(
  repoRoot,
  ".github",
  "workflows",
  "staging-first-promotion-gate.yml"
);

function stripQuotes(value) {
  return value.replace(/^['"]|['"]$/g, "").trim();
}

function collectJobNames(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const names = [];
  let inJobs = false;
  let currentJob = null;

  for (const line of lines) {
    if (!inJobs) {
      if (line.trim() === "jobs:") {
        inJobs = true;
      }
      continue;
    }

    if (/^\S/.test(line)) {
      break;
    }

    const jobMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (jobMatch) {
      currentJob = jobMatch[1];
      continue;
    }

    const nameMatch = currentJob && line.match(/^    name:\s*(.+?)\s*$/);
    if (nameMatch) {
      names.push(stripQuotes(nameMatch[1]));
      currentJob = null;
    }
  }

  return names;
}

function fail(message) {
  console.error(`Required check validation failed: ${message}`);
  process.exit(1);
}

const requiredChecks = JSON.parse(fs.readFileSync(checksPath, "utf8"));
const availableChecks = new Set([
  ...collectJobNames(ciWorkflowPath),
  ...collectJobNames(promotionGatePath),
]);

for (const branch of ["staging", "master"]) {
  const branchChecks = requiredChecks[branch];

  if (!Array.isArray(branchChecks) || branchChecks.length === 0) {
    fail(`"${branch}" must define a non-empty array in ${path.relative(repoRoot, checksPath)}.`);
  }

  const duplicates = branchChecks.filter((check, index) => branchChecks.indexOf(check) !== index);
  if (duplicates.length > 0) {
    fail(`"${branch}" contains duplicate check names: ${[...new Set(duplicates)].join(", ")}`);
  }

  const missing = branchChecks.filter((check) => !availableChecks.has(check));
  if (missing.length > 0) {
    fail(
      `"${branch}" references check names that are not defined by CI workflows: ${missing.join(", ")}`
    );
  }
}

const missingFromMaster = requiredChecks.staging.filter(
  (check) => !requiredChecks.master.includes(check)
);
if (missingFromMaster.length > 0) {
  fail(`"master" must include every staging check. Missing: ${missingFromMaster.join(", ")}`);
}

if (!requiredChecks.master.includes("Staging-First Promotion Gate")) {
  fail('"master" must include "Staging-First Promotion Gate".');
}

console.log(
  `Required checks validated: staging=${requiredChecks.staging.length}, master=${requiredChecks.master.length}`
);
