export interface LocalDocument {
  id: string;
  name: string;
  content: string;
  importedAt: number;
}

const DB = "lanshan-library";
const STORE = "documents";
let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error); };
  });
  return opening;
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function listDocuments(): Promise<LocalDocument[]> {
  const tx = (await db()).transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).getAll() as IDBRequest<LocalDocument[]>;
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.importedAt - a.importedAt));
    request.onerror = () => reject(request.error);
  });
}

export async function saveDocument(doc: LocalDocument): Promise<void> {
  const tx = (await db()).transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(doc);
  await transactionDone(tx);
}

export async function removeDocument(id: string): Promise<void> {
  const tx = (await db()).transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await transactionDone(tx);
}
