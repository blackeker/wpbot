import fs from 'fs';
import path from 'path';
import axios from 'axios';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { downloadsDir } from './config.js';

/**
 * Downloads a list of chapter image URLs and compiles them into a single PDF file.
 * Handles WebP, PNG, JPEG, GIF formats seamlessly via sharp image conversion.
 * 
 * @param {string[]} imageUrls - Array of image URLs for the manga chapter
 * @param {string} title - Chapter title for naming the output file
 * @param {object} [options] - Additional options (e.g. referer header)
 * @returns {Promise<{ title: string, pdfUrl: string, filePath: string, fileType: string }>}
 */
export async function compileMangaPagesToPdf(imageUrls, title, options = {}) {
  if (!imageUrls || imageUrls.length === 0) {
    throw new Error('PDF derleme için en az bir resim bağlantısı gereklidir.');
  }

  const safeTitle = title.replace(/[^a-zA-Z0-9_\-\.\s]/g, '_').trim();
  const fileName = `${safeTitle}_${Date.now()}.pdf`;
  const filePath = path.join(downloadsDir, fileName);

  const doc = new PDFDocument({ autoFirstPage: false });
  const writeStream = fs.createWriteStream(filePath);
  doc.pipe(writeStream);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ...(options.headers || {})
  };

  if (options.referer) {
    headers['Referer'] = options.referer;
  }

  let successCount = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    const imgUrl = imageUrls[i];
    try {
      const response = await axios.get(imgUrl, {
        responseType: 'arraybuffer',
        headers,
        timeout: 20000
      });

      let rawBuffer = Buffer.from(response.data);

      // Convert any format (WebP, GIF, BMP, etc.) to PNG buffer via sharp for PDFKit compatibility
      const pngBuffer = await sharp(rawBuffer).png().toBuffer();
      const img = doc.openImage(pngBuffer);

      doc.addPage({ size: [img.width, img.height] });
      doc.image(img, 0, 0, { width: img.width, height: img.height });
      successCount++;
    } catch (err) {
      console.error(`[MANGA PDF] Resim işlenemedi (${i + 1}/${imageUrls.length}): ${imgUrl}`, err.message);
    }
  }

  if (successCount === 0) {
    writeStream.destroy();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new Error('Manga sayfalarından hiçbiri indirilemedi veya PDF\'e eklenemedi.');
  }

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  return {
    title,
    pdfUrl: `/downloads/${encodeURIComponent(fileName)}`,
    filePath,
    fileName,
    fileType: 'pdf'
  };
}
