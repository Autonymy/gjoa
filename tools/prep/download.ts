import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { loadConfig } from "./config";
import { ENGINE_DIR, REPO_ROOT, SOURCES_CACHE } from "./paths";
import { log } from "./log";

// Mirrors Mozilla's release URL convention. Used for both .source.tar.xz and
// the SHA256SUMS file that publishes its hash.
function tarballUrl(version: string): string {
  return `https://archive.mozilla.org/pub/firefox/releases/${version}/source/firefox-${version}.source.tar.xz`;
}

function checksumUrl(version: string): string {
  return `https://archive.mozilla.org/pub/firefox/releases/${version}/SHA256SUMS`;
}

function tarballName(version: string): string {
  return `firefox-${version}.source.tar.xz`;
}

async function fetchSha256(version: string): Promise<string> {
  log.step(`fetching upstream SHA256SUMS for firefox ${version}`);
  const res = await fetch(checksumUrl(version));
  if (!res.ok) throw new Error(`failed to fetch SHA256SUMS: ${res.status}`);
  const text = await res.text();
  // Mozilla's SHA256SUMS lists files with subdirectory prefixes, e.g.
  // `source/firefox-150.0.source.tar.xz`. Match by basename.
  const want = tarballName(version);
  for (const line of text.split("\n")) {
    const [hash, file] = line.trim().split(/\s+/);
    if (file && (file === want || file.endsWith(`/${want}`))) return hash;
  }
  throw new Error(`SHA256SUMS does not list ${want}`);
}

async function sha256OfFile(path: string): Promise<string> {
  const file = Bun.file(path);
  const buf = await file.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(buf);
  return hash.digest("hex");
}

async function downloadTo(url: string, dest: string): Promise<void> {
  log.step(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (total) log.info(`expecting ${(total / 1024 / 1024).toFixed(1)} MB`);
  await Bun.write(dest, res);
}

export async function download(): Promise<void> {
  const cfg = loadConfig();
  mkdirSync(SOURCES_CACHE, { recursive: true });

  const tarball = join(SOURCES_CACHE, tarballName(cfg.firefox.version));
  const expectedHash = await fetchSha256(cfg.firefox.version);

  // Cache hit: existing tarball matches upstream hash. Skip download.
  if (existsSync(tarball)) {
    const have = await sha256OfFile(tarball);
    if (have === expectedHash) {
      log.ok(`cached tarball matches upstream hash, skipping download`);
    } else {
      log.warn(`cached tarball hash mismatch, re-downloading`);
      await downloadTo(tarballUrl(cfg.firefox.version), tarball);
    }
  } else {
    await downloadTo(tarballUrl(cfg.firefox.version), tarball);
  }

  // Verify post-download (also catches partial writes / network corruption).
  const actualHash = await sha256OfFile(tarball);
  if (actualHash !== expectedHash) {
    throw new Error(
      `tarball SHA256 mismatch.\n  expected: ${expectedHash}\n  got:      ${actualHash}`,
    );
  }
  log.ok(`tarball verified (${(statSync(tarball).size / 1024 / 1024).toFixed(1)} MB)`);

  // Extract into engine/. mozilla-central tarballs unpack as firefox-VERSION/
  // — strip that level so engine/ holds the source tree directly.
  if (existsSync(ENGINE_DIR)) {
    log.warn(`engine/ already exists; remove it first if you want a fresh extract`);
    return;
  }
  log.step(`extracting tarball to engine/ (this takes a couple minutes)`);
  mkdirSync(ENGINE_DIR);
  await $`tar -xJf ${tarball} -C ${ENGINE_DIR} --strip-components=1`.cwd(REPO_ROOT);
  log.ok(`engine/ ready`);
}
