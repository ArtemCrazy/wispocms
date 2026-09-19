// Run on the server only; never prints the generated key.
import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { isAbsolute, basename } from "node:path";

const target = process.argv[2];
if (!target || !isAbsolute(target) || basename(target) !== ".env.preview") {
  throw new Error("Provide the absolute path to the private server .env.preview");
}
const original = await readFile(target, "utf8");
const entries = original.split(/\r?\n/).filter((line) => /^AI_ENCRYPTION_KEY\s*=/.test(line));
if (entries.length > 1 || (entries.length === 1 && !/^AI_ENCRYPTION_KEY=[a-f\d]{64}$/i.test(entries[0]))) {
  throw new Error("AI_ENCRYPTION_KEY exists but is invalid. Refusing to replace existing key material.");
}
if (entries.length === 0) {
  const temporary = `${target}.ai-key-${randomBytes(8).toString("hex")}`;
  await writeFile(temporary, `${original.replace(/\s*$/, "")}\nAI_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}
await chmod(target, 0o600);
console.log("Server AI encryption key is ready (value not displayed).");
