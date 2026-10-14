const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Bot'un ana dizinindeki data.json yolunu belirleyelim
const DATA_PATH = path.resolve(__dirname, '../data/data.json');

// Bot'un menuData.js'deki emoji mantığını buraya taşıyalım
function getItemEmoji(item) {
    if (!item) return '🍽️';
    const t = item.toLowerCase();
    if (t.includes('corba')) return '🥣';
    if (t.includes('kek') || t.includes('tatli') || t.includes('helva') || t.includes('cikolata')) return '🍰';
    if (t.includes('recel') || t.includes('bal') || t.includes('tahin')) return '🍯';
    if (t.includes('cay') || t.includes('kahve')) return '☕';
    if (t.includes('su')) return '💧';
    if (t.includes('ayran') || t.includes('sut') || t.includes('meyve suyu') || t.includes('icecek')) return '🥤';
    if (t.includes('patates') || t.includes('kizartma')) return '🥔';
    if (t.includes('makarna') || t.includes('eriste')) return '🍝';
    if (t.includes('pilav') || t.includes('pirinc') || t.includes('bulgur')) return '🍚';
    if (t.includes('tavuk')) return '🍗';
    if (t.includes('kofte') || t.includes('kebab') || t.includes('et') || t.includes('doner')) return '🥩';
    if (t.includes('manti') || t.includes('nohut') || t.includes('fasulye')) return '🍲';
    if (t.includes('simit') || t.includes('pogaca') || t.includes('borek')) return '🥐';
    if (t.includes('pizza')) return '🍕';
    if (t.includes('ekmek')) return '🥖';
    if (t.includes('omlet') || t.includes('yumurta')) return '🍳';
    if (t.includes('peynir') || t.includes('kasar')) return '🧀';
    if (t.includes('zeytin')) return '🫒';
    if (t.includes('salata') || t.includes('cacik')) return '🥗';
    if (t.includes('yogurt')) return '🥣';
    if (t.includes('meyve')) return '🍎';
    return '🍽️';
}

// Menü verilerini okuma ve işleme API'si
app.get('/api/menu', (req, res) => {
    const dateQuery = req.query.date; // Format: DD.MM.YYYY

    try {
        if (!fs.existsSync(DATA_PATH)) {
            return res.status(404).json({ error: 'Menü verileri bulunamadı.' });
        }
        const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
        const data = JSON.parse(rawData);

        if (!dateQuery) {
            return res.json(data); // Tüm veriyi gönder
        }

        const menu = data.find(d => d.tarih === dateQuery);
        if (!menu) {
            return res.status(404).json({ error: 'Belirtilen tarih için menü bulunamadı.' });
        }

        // Emojileri ekleyerek gönderelim
        const formattedMenu = {
            ...menu,
            kahvalti: (menu.kahvalti || []).map(item => ({ text: item, emoji: getItemEmoji(item) })),
            aksam_yemegi: (menu.aksam_yemegi || []).map(item => ({ text: item, emoji: getItemEmoji(item) }))
        };

        res.json(formattedMenu);
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
    }
});

app.get('/api/dates', (req, res) => {
    try {
        const rawData = fs.readFileSync(DATA_PATH, 'utf-8');
        const data = JSON.parse(rawData);
        const dates = data.map(d => d.tarih);
        res.json(dates);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Yemek Menü API ${PORT} portunda çalışıyor!`);
});
