#!/usr/bin/env bun
// Concatenate beagle-compiled JS files into IIFE .uc.js bundles
// in dist/chrome/JS/ for GjoaLoader.
//
// Run via:
//   bun run chrome:bundle

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { entries, type Entry } from "./build.config";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const OUT_DIR = join(REPO_ROOT, "dist", "chrome", "JS");

type ProcessedFile = { code: string; exports: string[] };

function processFile(code: string): ProcessedFile {
  const exports: string[] = [];
  const processed = code
    .split("\n")
    .filter((line) => {
      if (/^import\s+/.test(line) && /from\s+['"]/.test(line)) return false;
      if (/^import\(/.test(line)) return false;
      return true;
    })
    .map((line) => {
      const fnMatch = line.match(/^export\s+function\s+(\w+)/);
      if (fnMatch) {
        exports.push(fnMatch[1]);
        return line.replace(/^export\s+function\s+(\w+)/, "$1 = function");
      }
      const declMatch = line.match(/^export\s+(?:const|let|var)\s+(\w+)/);
      if (declMatch) {
        exports.push(declMatch[1]);
        return line.replace(/^export\s+(?:const|let|var)\s+/, "");
      }
      return line;
    })
    .join("\n");
  return { code: processed, exports };
}

async function buildOne(entry: Entry): Promise<boolean> {
  const allExports: string[] = [];
  const blocks: string[] = [];
  for (const file of entry.files) {
    const absPath = join(REPO_ROOT, file);
    try {
      const raw = await readFile(absPath, "utf-8");
      const { code, exports } = processFile(raw);
      allExports.push(...exports);
      blocks.push(`{\n${code}\n}`);
    } catch (err: any) {
      console.error(`✗ ${file}: ${err.message}`);
      return false;
    }
  }

  const unique = [...new Set(allExports)];
  const varDecl = unique.length > 0 ? `var ${unique.join(", ")};\n\n` : "";
  const body = blocks.join("\n\n");
  const iife = `(function() {\n"use strict";\n${varDecl}${body}\n})();`;
  const output = entry.banner + "\n\n" + iife;
  const outPath = join(OUT_DIR, entry.out);
  await writeFile(outPath, output);
  console.log(`✓ ${outPath}  (${body.length} bytes)`);
  return true;
}

await mkdir(OUT_DIR, { recursive: true });
const results = await Promise.all(entries.map(buildOne));
if (results.some((ok) => !ok)) process.exit(1);
