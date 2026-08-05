import type {
  BufferedChange,
  ChangeBuffer,
  ChangelogEntry,
  ClassifiedPR,
  DocsAffected,
  Release,
  ReleaseReport,
} from "../types.js";

/**
 * Per-bucket cap. A package that accumulates for months without releasing would
 * otherwise grow the KV document without bound.
 */
export const MAX_BUFFERED_PER_BUCKET = 500;

export function emptyBuffer(): ChangeBuffer {
  return { buckets: {}, dropped: {} };
}

/**
 * File a classified PR into every package bucket it touched.
 *
 * Only package changes are buffered. Docs are announced in the run that finds
 * them and never replayed, so they are deliberately absent here — the buffer
 * holds exactly "package work that has not shipped yet".
 *
 * A PR spanning two packages lands in both and is reported with each, which is
 * accurate: the change genuinely ships in both releases.
 */
export function appendToBuffer(buffer: ChangeBuffer, prs: ClassifiedPR[]): void {
  for (const classified of prs) {
    if (classified.packageLabels.length === 0) continue;

    const areas: Record<string, string[]> = {};
    const docs: DocsAffected[] = [];
    const seenDocs = new Set<string>();

    for (const label of classified.packageLabels) {
      const list = (areas[label.bucket] ??= []);
      if (!list.includes(label.subpath)) list.push(label.subpath);

      for (const doc of label.docs) {
        if (seenDocs.has(doc.url)) continue;
        seenDocs.add(doc.url);
        docs.push(doc);
      }
    }

    for (const bucket of Object.keys(areas)) {
      push(buffer, bucket, {
        number: classified.pr.number,
        title: classified.pr.title,
        url: classified.pr.htmlUrl,
        author: classified.pr.author,
        mergedAt: classified.pr.mergedAt,
        areas,
        docs,
      });
    }
  }
}

function push(buffer: ChangeBuffer, bucket: string, change: BufferedChange): void {
  const existing = buffer.buckets[bucket] ?? [];

  // The dedup set upstream should prevent this, but a re-run must not duplicate.
  if (existing.some((c) => c.number === change.number)) return;

  existing.push(change);

  if (existing.length > MAX_BUFFERED_PER_BUCKET) {
    const overflow = existing.length - MAX_BUFFERED_PER_BUCKET;
    existing.splice(0, overflow); // drop oldest
    buffer.dropped[bucket] = (buffer.dropped[bucket] ?? 0) + overflow;
  }

  buffer.buckets[bucket] = existing;
}

/**
 * Which buckets a release drains.
 *
 * A scoped tag (`channels/v0.3.0`) drains only its own package, so accumulated
 * react-core work keeps waiting for its own release. A repo-wide tag (`v1.63.2`,
 * ag-ui's `release/2026-07-28`) drains everything.
 */
export function bucketsForRelease(buffer: ChangeBuffer, scope: string | null): string[] {
  if (scope === null) return Object.keys(buffer.buckets);
  return buffer.buckets[scope] ? [scope] : [];
}

/**
 * Build the report for a release WITHOUT mutating the buffer.
 *
 * Draining is deliberately separate: the buffer must survive a failed webhook,
 * so `drainBuckets` is only called once delivery is confirmed.
 *
 * `claimed` makes multiple releases in one run partition the buffer instead of
 * each reporting all of it — a change belongs to the first release published
 * after it merged.
 */
export function buildReleaseReport(
  buffer: ChangeBuffer,
  release: Release,
  scope: string | null,
  claimed: Set<number> = new Set(),
): ReleaseReport {
  const buckets = bucketsForRelease(buffer, scope);
  const publishedAt = Date.parse(release.publishedAt);

  // A PR touching several released packages appears in several buckets; collect
  // it once so it is never listed twice.
  const byNumber = new Map<number, BufferedChange>();
  let droppedCount = 0;

  for (const bucket of buckets) {
    droppedCount += buffer.dropped[bucket] ?? 0;
    for (const change of buffer.buckets[bucket] ?? []) {
      // A change cannot have shipped in a release cut before it merged.
      if (Date.parse(change.mergedAt) > publishedAt) continue;
      if (claimed.has(change.number)) continue;

      byNumber.set(change.number, change);
    }
  }

  for (const number of byNumber.keys()) claimed.add(number);

  const released = new Set(buckets);
  const entries = [...byNumber.values()]
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
    .map((change) => toEntry(change, released));

  return {
    release,
    scope,
    entries,
    docsAffected: collectDocs(entries),
    totalChanges: entries.length,
    droppedCount,
  };
}

/**
 * One PR, with the packages it touched nested under it.
 *
 * Restricted to the packages this release actually drained, so a scoped
 * `channels/v0.3.0` report does not advertise the react-core files the same PR
 * happened to touch.
 */
function toEntry(change: BufferedChange, released: Set<string>): ChangelogEntry {
  const packages = Object.entries(change.areas)
    .filter(([pkg]) => released.has(pkg))
    .map(([pkg, subpaths]) => ({ pkg, subpaths: [...subpaths].sort() }))
    .sort((a, b) => a.pkg.localeCompare(b.pkg));

  return { change, packages };
}

/** Deduped docs pages across a release, reference pages before guides. */
function collectDocs(entries: ChangelogEntry[]): DocsAffected[] {
  const byUrl = new Map<string, DocsAffected>();

  for (const entry of entries) {
    for (const doc of entry.change.docs) {
      if (!byUrl.has(doc.url)) byUrl.set(doc.url, doc);
    }
  }

  return [...byUrl.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "reference" ? -1 : 1;
    return a.text.localeCompare(b.text);
  });
}

/** Purge the drained buckets. Call only after delivery is confirmed. */
export function drainBuckets(buffer: ChangeBuffer, buckets: string[]): void {
  for (const bucket of buckets) {
    delete buffer.buckets[bucket];
    delete buffer.dropped[bucket];
  }
}

export function bufferSize(buffer: ChangeBuffer): number {
  return Object.values(buffer.buckets).reduce((sum, list) => sum + list.length, 0);
}
