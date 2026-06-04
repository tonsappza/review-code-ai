import type { PrFileChange } from "../github.js";

export type DiffChunk = {
  files: string[];
  diff: string;
  skipped?: boolean;
  skipReason?: string;
};

const DEFAULT_MAX_CHUNK_CHARS = 35_000;
const DEFAULT_MAX_CHUNKS = 12;

export function getChunkThreshold(): number {
  const n = Number.parseInt(process.env.CHUNK_DIFF_THRESHOLD ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

export function getMaxChunks(): number {
  const n = Number.parseInt(process.env.MAX_REVIEW_CHUNKS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_CHUNKS;
}

/** Build per-file chunks from GitHub listFiles patches (preferred). */
export function buildChunksFromFileChanges(
  files: PrFileChange[],
): { chunks: DiffChunk[]; skipped: DiffChunk[] } {
  const chunks: DiffChunk[] = [];
  const skipped: DiffChunk[] = [];

  for (const f of files) {
    if (f.status === "removed" || f.status === "renamed") {
      if (f.patch) {
        chunks.push({
          files: [f.filename],
          diff: formatFileDiff(f.filename, f.patch),
        });
      }
      continue;
    }

    if (!f.patch) {
      skipped.push({
        files: [f.filename],
        diff: "",
        skipped: true,
        skipReason: "no patch (file too large or binary)",
      });
      continue;
    }

    chunks.push({
      files: [f.filename],
      diff: formatFileDiff(f.filename, f.patch),
    });
  }

  return { chunks, skipped };
}

function formatFileDiff(filename: string, patch: string): string {
  return `diff --git a/${filename} b/${filename}\n${patch}`;
}

/** Merge small consecutive chunks to stay under maxChunks. */
export function packChunks(
  chunks: DiffChunk[],
  maxChunks = getMaxChunks(),
  maxChars = DEFAULT_MAX_CHUNK_CHARS,
): DiffChunk[] {
  if (chunks.length <= maxChunks) return chunks;

  const packed: DiffChunk[] = [];
  let batch: DiffChunk | null = null;

  const flush = () => {
    if (batch) {
      packed.push(batch);
      batch = null;
    }
  };

  for (const c of chunks) {
    if (!batch) {
      batch = { files: [...c.files], diff: c.diff };
      continue;
    }
    const mergedLen = batch.diff.length + c.diff.length;
    if (
      packed.length < maxChunks - 1 &&
      mergedLen < maxChars &&
      batch.files.length < 4
    ) {
      batch.files.push(...c.files);
      batch.diff += `\n${c.diff}`;
    } else {
      flush();
      batch = { files: [...c.files], diff: c.diff };
    }
  }
  flush();

  return packed.slice(0, maxChunks);
}

export function shouldUseChunkedReview(
  diffLength: number,
  fileCount: number,
): boolean {
  return diffLength > getChunkThreshold() || fileCount > 8;
}
