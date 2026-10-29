import { createJiti } from "jiti";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const jiti = createJiti(import.meta.url);
const testsDir = join(process.cwd(), "tests");

console.log("\n🧪 Running Unit Tests with Jiti & Node:test...\n");

try {
  const files = readdirSync(testsDir).filter(f => f.endsWith(".test.ts") || f.endsWith(".spec.ts"));
  if (files.length === 0) {
    console.log("No test files found in tests/");
    process.exit(0);
  }

  for (const file of files) {
    const fullPath = join(testsDir, file);
    console.log(`▶ Loading test: ${file}`);
    await jiti.import(fullPath);
  }
} catch (err) {
  console.error("Test execution error:", err);
  process.exit(1);
}
