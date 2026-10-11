/**
 * 🧪 Test Script: Cross-Session User Profile & Fact Recall Validation
 * 
 * Bu test betiği, yapay zekanın konuşma geçmişi (chat history) sıfırlansa,
 * oturum kapansa veya yeni bir güne başlansa bile diske kaydedilen kalıcı
 * kullanıcı profilindeki bilgileri (isim, meslek, şehir, evcil hayvan, zevkler)
 * sonraki bağımsız oturumlarda başarıyla hatırladığını ve güncelleyebildiğini doğrular.
 */

import path from 'path';
import fs from 'fs';
import { aiEngine, handleAiChat, memoryManager, userProfileManager } from '../ai/aiEngine.js';
import { UserProfileManager } from '../ai/userProfileManager.js';
import { dataPath } from '../config.js';

// Test Configuration
const TEST_JID = '905553334455@s.whatsapp.net';
const TEST_SENDER = 'Deniz';
const STORAGE_FILE = path.join(dataPath || './data', 'user_profiles.json');

const fakeSocket = {
  sendPresenceUpdate: async () => {},
  sendMessage: async (to, content) => {
    return { key: { id: 'test-msg-' + Date.now() }, content };
  }
};

function logStep(stepNum, title) {
  console.log(`\n${'='.repeat(65)}`);
  console.log(`🔹 ADIM ${stepNum}: ${title}`);
  console.log(`${'='.repeat(65)}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ BAŞARISIZ: ${message}`);
    throw new Error(`Test assertion failed: ${message}`);
  }
  console.log(`  ✅ [PASS] ${message}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCrossSessionMemoryTest() {
  console.log(`\n🚀 [TEST BAŞLADI] Çapraz Oturum Kalıcı Bellek Doğrulama Testi`);
  console.log(`📁 Veri Depolama Dosyası: ${STORAGE_FILE}`);
  console.log(`👤 Test Kullanıcı JID: ${TEST_JID} (${TEST_SENDER})\n`);

  try {
    // -------------------------------------------------------------
    // 0. Temiz Başlangıç
    // -------------------------------------------------------------
    userProfileManager.clearProfile(TEST_JID);
    memoryManager.clearHistory(TEST_JID);
    userProfileManager.saveToDisk();

    // -------------------------------------------------------------
    // ADIM 1: Oturum 1 (Öğrenme Oturumu / Fact Seeding)
    // -------------------------------------------------------------
    logStep(1, 'Oturum 1 — Kullanıcı Kendini ve Bilgilerini Tanıtıyor');

    const msg1 = { pushName: TEST_SENDER, key: { participant: TEST_JID } };
    const prompt1 = "Selam kanka! Benim adım Deniz, Eskişehir'de mimarlık yapıyorum. Bir de Mavi adında muhabbet kuşum var.";
    
    console.log(`[Oturum 1 - Girdi]: "${prompt1}"`);
    const reply1 = await handleAiChat(fakeSocket, msg1, TEST_JID, prompt1, { senderName: TEST_SENDER });
    console.log(`[Oturum 1 - Yapay Zeka Yanıtı]:\n${reply1.text}\n`);

    // İkinci mesajda ek zevkler ve kısıtlamalar belirtilir
    const prompt1_2 = "Ayrıca klasik gitar çalıyorum ve sütten yapılan tatlıları hiç sevmem, midemi bulandırıyor.";
    console.log(`[Oturum 1 - Girdi 2]: "${prompt1_2}"`);
    const reply1_2 = await handleAiChat(fakeSocket, msg1, TEST_JID, prompt1_2, { senderName: TEST_SENDER });
    console.log(`[Oturum 1 - Yapay Zeka Yanıtı 2]:\n${reply1_2.text}\n`);

    // Diske doğrudan flush et
    userProfileManager.saveToDisk();

    // Oturum 1 doğrulama
    const seededProfile = userProfileManager.getProfile(TEST_JID);
    console.log('📊 Oturum 1 Sonrası Kaydedilen Profil:', JSON.stringify(seededProfile, null, 2));

    assert(seededProfile.name === 'Deniz', "Kullanıcı adı 'Deniz' olarak kaydedildi");
    assert(seededProfile.notes.sehir === 'Eskişehir', "Şehir 'Eskişehir' olarak not edildi");
    assert(seededProfile.notes.meslek?.toLowerCase().includes('mimar'), "Meslek 'Mimar' olarak not edildi");
    assert(seededProfile.message_count >= 2, "Etkileşim sayısı kaydedildi");

    // -------------------------------------------------------------
    // ADIM 2: Oturum Sınırı & Bellek Sıfırlama (Simulating Session Reset)
    // -------------------------------------------------------------
    logStep(2, 'Oturum Sınırı Geçişi — RAM Sohbet Geçmişi Sıfırlanıyor & Yeni Oturum Başlatılıyor');
    
    // Aktif RAM sohbet geçmişini tamamen siliyoruz (rolling history cleared)
    memoryManager.clearHistory(TEST_JID);
    const activeHistory = memoryManager.getHistory(TEST_JID);
    assert(activeHistory.length === 0, "Aktif RAM sohbet geçmişi tamamen boşaltıldı (0 mesaj)");

    // Tamamen bağımsız yeni bir UserProfileManager örneği diski yeniden okusun (Cold Restart Simülasyonu)
    const freshProfileManager = new UserProfileManager({ storageFile: STORAGE_FILE });
    const diskProfile = freshProfileManager.getProfile(TEST_JID);
    assert(diskProfile && diskProfile.name === 'Deniz', "Soğuk başlatmada diskten profil başarıyla geri yüklendi");

    // -------------------------------------------------------------
    // ADIM 3: Oturum 2 (Sıfır Sohbet Geçmişiyle Hatırlama / Zero-Context Recall)
    // -------------------------------------------------------------
    logStep(3, 'Oturum 2 — Sohbet Geçmişi Olmadan Bilgi Hatırlama Testi (Recall)');

    const prompt2 = "Kanka uzun zaman oldu! Benim adım neydi, hangi şehirde ne iş yapıyordum ve evde hangi hayvanım vardı hatırlıyor musun?";
    console.log(`[Oturum 2 - Girdi (Yeni Sohbet)]: "${prompt2}"`);
    
    // Bu çağrıda memoryManager.getHistory(TEST_JID) boştur; tüm bilgi kalıcı profilden gelmelidir
    const reply2 = await handleAiChat(fakeSocket, msg1, TEST_JID, prompt2, { senderName: TEST_SENDER });
    console.log(`[Oturum 2 - Yapay Zeka Yanıtı]:\n${reply2.text}\n`);

    const lowerReply2 = reply2.text.toLowerCase();

    // AI yanıtı Deniz, Eskişehir, Mimar ve Kuş / Mavi detaylarını içermelidir
    const recallsName = lowerReply2.includes('deniz');
    const recallsCity = lowerReply2.includes('eskişehir') || lowerReply2.includes('eskisehir');
    const recallsJob = lowerReply2.includes('mimar');
    const recallsPet = lowerReply2.includes('mavi') || lowerReply2.includes('kuş') || lowerReply2.includes('muhabbet');

    assert(recallsName, "Yapay zeka önceki oturumdaki ismi (Deniz) hatırladı");
    assert(recallsCity, "Yapay zeka önceki oturumdaki şehri (Eskişehir) hatırladı");
    assert(recallsJob, "Yapay zeka önceki oturumdaki mesleği (Mimar) hatırladı");
    assert(recallsPet, "Yapay zeka önceki oturumdaki evcil hayvanı (Mavi / Kuş) hatırladı");

    // -------------------------------------------------------------
    // ADIM 4: Oturum 3 — Çapraz Oturumda Bilgi Güncelleme & Değiştirme
    // -------------------------------------------------------------
    logStep(4, 'Oturum 3 — Çapraz Oturum Bilgi Güncellemesi (Eskişehir -> Ankara, Gitar -> Bateri)');

    const prompt3 = "Kanka müjdem var! Artık gitarı bıraktım bateri çalıyorum. Ayrıca Eskişehir'den Ankara'ya taşındım!";
    console.log(`[Oturum 3 - Girdi]: "${prompt3}"`);
    const reply3 = await handleAiChat(fakeSocket, msg1, TEST_JID, prompt3, { senderName: TEST_SENDER });
    console.log(`[Oturum 3 - Yapay Zeka Yanıtı]:\n${reply3.text}\n`);

    userProfileManager.saveToDisk();

    const finalDiskManager = new UserProfileManager({ storageFile: STORAGE_FILE });
    const updatedProfile = finalDiskManager.getProfile(TEST_JID);
    console.log('📊 Oturum 3 Güncellenmiş Profil:', JSON.stringify(updatedProfile, null, 2));

    assert(updatedProfile.notes.sehir === 'Ankara', "Şehir bilgisi 'Ankara' olarak güncellendi");

    // -------------------------------------------------------------
    // ADIM 5: Oturum 4 — Güncellenen Bilginin Doğrulanması (Final Verification)
    // -------------------------------------------------------------
    logStep(5, 'Oturum 4 — Yeni Oturumda Güncel Bilgilerin Teyit Edilmesi');

    // Belleği tekrar sıfırlıyoruz
    memoryManager.clearHistory(TEST_JID);

    const prompt4 = "Şu an hangi şehirdeyim kanka?";
    console.log(`[Oturum 4 - Girdi]: "${prompt4}"`);
    const reply4 = await handleAiChat(fakeSocket, msg1, TEST_JID, prompt4, { senderName: TEST_SENDER });
    console.log(`[Oturum 4 - Yapay Zeka Yanıtı]:\n${reply4.text}\n`);

    const lowerReply4 = reply4.text.toLowerCase();
    assert(lowerReply4.includes('ankara'), "Yeni oturumda güncellenen şehir (Ankara) hatırlandı");

    // -------------------------------------------------------------
    // Temizlik ve Başarı
    // -------------------------------------------------------------
    userProfileManager.clearProfile(TEST_JID);
    memoryManager.clearHistory(TEST_JID);
    userProfileManager.saveToDisk();

    console.log(`\n${'='.repeat(65)}`);
    console.log(`🎉 TÜM ÇAPRAZ OTURUM VE KALICI BELLEK DOĞRULAMA TESTLERİ BAŞARILI!`);
    console.log(`${'='.repeat(65)}\n`);
    process.exit(0);

  } catch (err) {
    console.error(`\n❌ TEST SIRASINDA KRİTİK HATA OLUŞTU:`, err);
    process.exit(1);
  }
}

runCrossSessionMemoryTest();
