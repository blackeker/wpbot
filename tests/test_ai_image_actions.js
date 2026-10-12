import assert from 'node:assert/strict';
import { isImageGenerationRequest, parseImageAction } from '../ai/aiEngine.js';

const markdownAction = `İşte:
\`\`\`json
{"action":"generate_image","prompt":"A realistic cat","style":"foto","shape":"landscape","message":"Hazırlıyorum"}
\`\`\``;
const parsed = parseImageAction(markdownAction);
assert.equal(parsed.action, 'generate_image');
assert.equal(parsed.prompt, 'A realistic cat');
assert.equal(parsed.shape, 'landscape');
assert.equal(parsed.message, 'Hazırlıyorum');

const alternateSchema = parseImageAction(
  '{"type":"image_generation","image_prompt":"A cabin","aspect_ratio":"16:9"}'
);
assert.equal(alternateSchema.action, 'generate_image');
assert.equal(alternateSchema.prompt, 'A cabin');
assert.equal(alternateSchema.shape, '16:9');

assert.equal(parseImageAction('{"prompt":"A cabin"}'), null);
assert.equal(parseImageAction('{"prompt":"A cabin"}', { allowImplicit: true }).prompt, 'A cabin');
assert.equal(isImageGenerationRequest('Gerçekçi yatay bir kedi resmi oluştur'), true);
assert.equal(isImageGenerationRequest('Bana anime kızı çiz'), true);
assert.equal(isImageGenerationRequest('Bu görselde ne var?'), false);
assert.equal(isImageGenerationRequest('görseli tarif et'), false);
assert.equal(
  isImageGenerationRequest('arkaplanı gece yap', [{ role: 'assistant', content: '[Görsel Üretildi: "cat"]' }]),
  true
);

console.log('AI image action tests passed.');
process.exit(0);
