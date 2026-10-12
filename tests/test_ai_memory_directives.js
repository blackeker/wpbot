import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserProfileManager } from '../ai/userProfileManager.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpbot-ai-memory-'));
const manager = new UserProfileManager({
  storageFile: path.join(tempDir, 'profiles.json')
});

try {
  const jid = '905550001111@s.whatsapp.net';
  manager.autoExtractUserFacts(jid, "Benim adım Deniz, Eskişehir'de yaşıyorum. Rock müziği seviyorum.");
  let profile = manager.getProfile(jid);
  assert.equal(profile.name, 'Deniz');
  assert.equal(profile.notes.sehir, 'Eskişehir');
  assert.equal(profile.preferences.likes.length, 1);

  manager.autoExtractUserFacts(jid, "Artık Ankara'da yaşıyorum ve rock müziği sevmiyorum, cazı seviyorum.");
  profile = manager.getProfile(jid);
  assert.equal(profile.notes.sehir, 'Ankara');
  assert.equal(profile.preferences.likes.some(value => /caz/i.test(value)), true);
  assert.equal(profile.preferences.dislikes.some(value => /rock/i.test(value)), true);
  assert.equal(profile.preferences.likes.some(value => /rock/i.test(value)), false);

  const { cleanText, actionsApplied } = manager.processAiMemoryDirectives(
    jid,
    'Bunu aklımda tutacağım. [MEMORY_SET: meslek=Öğretmen] [MEMORY_NICKNAME: Deno] ' +
      '[MEMORY_LIKE: yürüyüş] [MEMORY_UNDISLIKE: rock] [MEMORY_ADD: Pati adında bir kedisi var]'
  );
  profile = manager.getProfile(jid);
  assert.equal(cleanText, 'Bunu aklımda tutacağım.');
  assert.equal(profile.notes.meslek, 'Öğretmen');
  assert.equal(profile.nickname, 'Deno');
  assert.equal(profile.preferences.likes.some(value => /yürüyüş/i.test(value)), true);
  assert.equal(profile.preferences.dislikes.some(value => /rock/i.test(value)), false);
  assert.equal(profile.facts.some(value => /Pati/i.test(value)), true);
  assert.equal(actionsApplied.length, 5);

  manager.processAiMemoryDirectives(jid, '[MEMORY_REMOVE: Pati] [MEMORY_DELETE: meslek]');
  profile = manager.getProfile(jid);
  assert.equal(profile.facts.some(value => /Pati/i.test(value)), false);
  assert.equal(profile.notes.meslek, undefined);
  console.log('AI memory directive tests passed.');
} finally {
  if (manager.saveTimeout) clearTimeout(manager.saveTimeout);
  fs.rmSync(tempDir, { recursive: true, force: true });
}
process.exit(0);
