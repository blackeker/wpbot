import assert from 'node:assert/strict';
import test from 'node:test';
import { isImageGenerationRequest, parseImageAction, isVariationRequest } from '../ai/aiEngine.js';

test('recognizes short Turkish drawing requests', () => {
  assert.equal(isImageGenerationRequest('kurt çiz'), true);
  assert.equal(isImageGenerationRequest('bana bir kedi çiz'), true);
  assert.equal(isImageGenerationRequest('bir çizgi film güzelmiş'), false);
  assert.equal(isImageGenerationRequest('bugün hava güzel'), false);
});

test('recognizes edits to a previously generated image', () => {
  const history = [{ role: 'assistant', content: '[Görsel Üretildi: "a wolf" | Stil: Anime & Manga]' }];
  assert.equal(isImageGenerationRequest('arka planı gece yap', history), true);
  assert.equal(isImageGenerationRequest('arka planı gece yap'), false);
});

test('parses an image action from a model JSON response', () => {
  const action = parseImageAction('{"action":"generate_image","prompt":"a red fox"}');
  assert.equal(action?.prompt, 'a red fox');
});

test('recognizes variation requests', () => {
  assert.equal(isVariationRequest('varyasyon yap'), true);
  assert.equal(isVariationRequest('variation et'), true);
  assert.equal(isVariationRequest('bu görselin varyasyonlarını üret'), true);
  assert.equal(isVariationRequest('benzeri bir tane yap'), true);
  assert.equal(isVariationRequest('alternatif bir versiyon oluştur'), true);
  assert.equal(isVariationRequest('make a variation'), true);
  assert.equal(isVariationRequest('create similar image'), true);
  assert.equal(isVariationRequest('normal mesaj'), false);
  assert.equal(isVariationRequest('merhaba nasılsın'), false);
});
