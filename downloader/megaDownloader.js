import fs from 'fs';
import { File } from 'megajs';

export async function downloadMegaFile(megaUrl, outputPath, signal, progressCallback) {
  const file = File.fromURL(megaUrl);
  await file.loadAttributes();
  const fileStream = file.download();
  const writeStream = fs.createWriteStream(outputPath);
  
  let completed = 0;
  const total = file.size || 0;
  
  return new Promise((resolve, reject) => {
    if (signal) {
      const abortHandler = () => {
        fileStream.destroy();
        writeStream.destroy();
        reject(new Error("İndirme iptal edildi."));
      };
      signal.addEventListener('abort', abortHandler);
    }

    fileStream.on('data', (chunk) => {
      completed += chunk.length;
      if (progressCallback) {
        progressCallback(completed, total);
      }
    });

    fileStream.on('error', (err) => {
      writeStream.destroy();
      reject(err);
    });

    writeStream.on('finish', () => {
      resolve();
    });

    writeStream.on('error', (err) => {
      reject(err);
    });

    fileStream.pipe(writeStream);
  });
}

