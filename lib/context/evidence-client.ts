export interface EvidenceDocument {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  chunkCount: number;
  createdAt: string;
}
export interface EvidenceExcerpt {
  excerptId: string;
  evidenceId: string;
  name: string;
  text: string;
  score: number;
  chunkIndex: number;
}
export type ResearchResponse =
  | {
      status: "OK";
      provider: string;
      results: Array<{
        resultId: string;
        title: string;
        url: string;
        snippet: string;
      }>;
    }
  | { status: "BLOCKED"; reason: string; action: string };
export interface EvidenceBridge {
  researchStatus(): Promise<{ provider: string; configured: boolean }>;
  researchConfigure(input: {
    apiKey: string;
  }): Promise<{ provider: string; configured: boolean }>;
  evidenceImport(input: {
    name: string;
    text: string;
    mime?: string;
  }): Promise<EvidenceDocument & { duplicate: boolean }>;
  evidenceList(): Promise<EvidenceDocument[]>;
  evidenceSearch(input: {
    query: string;
    limit?: number;
  }): Promise<EvidenceExcerpt[]>;
  webResearch(input: {
    query: string;
    approved: true;
  }): Promise<ResearchResponse>;
  researchImport(input: {
    resultId: string;
    approved: true;
  }): Promise<EvidenceDocument & { duplicate: boolean }>;
}
export function nativeEvidence(): EvidenceBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const api = (window as unknown as { plantlensDesktop?: EvidenceBridge })
    .plantlensDesktop;
  return api?.evidenceImport ? api : undefined;
}

type StoredDocument = EvidenceDocument & { text: string };
function openEvidence(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("engineering-context-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("documents", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Local context storage could not open. Check browser storage permissions.",
        ),
      );
  });
}
async function records(): Promise<StoredDocument[]> {
  const db = await openEvidence();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("documents")
        .objectStore("documents")
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(new Error("Could not read local documents."));
    });
  } finally {
    db.close();
  }
}
function metadata({
  text: _text,
  ...document
}: StoredDocument): EvidenceDocument {
  void _text;
  return document;
}
export async function listEvidence(): Promise<EvidenceDocument[]> {
  const api = nativeEvidence();
  return api ? api.evidenceList() : (await records()).map(metadata);
}
export async function importEvidence(file: {
  name: string;
  text: string;
  mime?: string;
}) {
  if (!file.name || file.name.length > 200 || /[\\/\u0000]/.test(file.name))
    throw new Error("Use a plain filename of at most 200 characters.");
  if (/\.json$/i.test(file.name)) {
    try {
      JSON.parse(file.text);
    } catch {
      throw new Error("JSON context must contain valid JSON.");
    }
  }
  if (!/\.(txt|md|csv|json)$/i.test(file.name))
    throw new Error(
      "Use TXT, Markdown, CSV or JSON. PDF/image extraction is not available in this preview; export text first.",
    );
  const bytes = new TextEncoder().encode(file.text);
  if (!file.text.trim() || bytes.length > 524288)
    throw new Error(
      "Context files must contain text and be no larger than 512 KB.",
    );
  const api = nativeEvidence();
  if (api) return api.evidenceImport(file);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const all = await records();
  const prior = all.find((document) => document.id === id);
  if (prior) return { ...metadata(prior), duplicate: true };
  if (
    all.length >= 20 ||
    all.reduce((sum, document) => sum + document.bytes, 0) + bytes.length >
      8 * 1024 * 1024
  )
    throw new Error(
      "Browser context quota reached. Use the desktop workspace for additional documents; no stored evidence was removed.",
    );
  const document: StoredDocument = {
    id,
    name: file.name.slice(0, 200),
    mime: file.mime || "text/plain",
    bytes: bytes.length,
    chunkCount: Math.ceil(file.text.length / 650),
    createdAt: new Date().toISOString(),
    text: file.text,
  };
  const db = await openEvidence();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("documents", "readwrite");
      transaction.objectStore("documents").add(document);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          new Error("Context could not be saved. Local storage may be full."),
        );
    });
  } finally {
    db.close();
  }
  return { ...metadata(document), duplicate: false };
}
export async function searchEvidence(
  query: string,
): Promise<EvidenceExcerpt[]> {
  const api = nativeEvidence();
  if (api) return api.evidenceSearch({ query, limit: 8 });
  const terms = Array.from(
    new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []),
  ).slice(0, 16);
  if (!terms.length) return [];
  const results: EvidenceExcerpt[] = [];
  for (const document of await records()) {
    for (let offset = 0; offset < document.text.length; offset += 650) {
      const text = document.text.slice(offset, offset + 800);
      const score = terms.filter((term) =>
        text.toLowerCase().includes(term),
      ).length;
      if (score)
        results.push({
          excerptId: `${document.id}:${offset / 650}`,
          evidenceId: document.id,
          name: document.name,
          text,
          score,
          chunkIndex: offset / 650,
        });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 8);
}
