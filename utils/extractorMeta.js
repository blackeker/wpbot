// Centralized metadata normalizer for extractor results.
// Wraps a raw extractor result (string URL or object) into a consistent shape.
export function normalizeExtractorResult(raw, extractorName = 'unknown') {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return {
      downloadUrl: raw,
      fileSize: null,
      fileName: null,
      extractorName,
      quality: null,
      progress: 0
    };
  }
  return {
    downloadUrl: raw.downloadUrl || raw.url || raw.streamUrl || null,
    fileSize: raw.fileSize || raw.size || null,
    fileName: raw.fileName || raw.name || null,
    extractorName: raw.extractorName || extractorName,
    quality: raw.quality || raw.resolution || null,
    progress: raw.progress || 0,
    ...raw
  };
}

export function enrichTaskMetadata(task, meta = {}) {
  if (!task) return task;
  task.fileSize = meta.fileSize ?? task.fileSize ?? null;
  task.downloadUrl = meta.downloadUrl ?? task.downloadUrl ?? null;
  task.fileName = meta.fileName ?? task.fileName ?? null;
  task.extractorName = meta.extractorName ?? task.extractorName ?? null;
  task.progress = meta.progress ?? task.progress ?? 0;
  return task;
}
