import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractMessageCases } from "./lib/messages";
import { swiftHeader, swiftEnum } from "./lib/swift";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SHARED = join(REPO_ROOT, "packages", "shared", "src");
const OUT = join(REPO_ROOT, "native", "Sources", "Taskflow", "Generated");

function emit(relPath: string, body: string): void {
    const full = join(OUT, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, swiftHeader() + body);
    console.log(`emitted ${relPath}`);
}

// MessageType enum from MSG.
const constants = readFileSync(join(SHARED, "constants.ts"), "utf8");
emit("MessageType.swift", swiftEnum("MessageType", extractMessageCases(constants)));

// Model emission is added in Tasks 4-5.
