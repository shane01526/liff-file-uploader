const cors = require('cors');
app.use(cors());

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 10000;

// 基本中介軟體
app.use(express.json());
app.use(express.static('.')); // 提供 index.html
app.use('/uploads', express.static('./uploads')); // 提供上傳的檔案

// 確保上傳目錄存在
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 上傳配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 上傳端點
app.post('/api/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ success: false, error: '沒有收到檔案' });
        }

        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        const fileInfo = {
            fileName: req.file.originalname,
            fileUrl,
            fileSize: req.file.size,
            uploadTime: new Date().toISOString()
        };

        res.json({ success: true, ...fileInfo });

        // 可選：自動發送 LINE 通知
        if (process.env.LINE_CHANNEL_ACCESS_TOKEN && req.query.userId) {
            sendLineNotify(req.query.userId, fileInfo);
        }
    });
});

// 下載端點
app.get('/api/download/:filename', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ success: false, error: '檔案不存在' });
    }
});

// LINE 通知端點
app.post('/api/notify', async (req, res) => {
    try {
        const { userId, fileInfo } = req.body;
        if (!userId || !fileInfo) {
            return res.status(400).json({ success: false, error: '缺少 userId 或 fileInfo' });
        }
        await sendLineNotify(userId, fileInfo);
        res.json({ success: true, message: 'LINE 通知發送成功' });
    } catch (error) {
        res.status(500).json({ success: false, error: 'LINE 通知失敗', details: error.message });
    }
});

// 健康檢查
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uploadDir,
        hasLineToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN
    });
});

// 發送 LINE 訊息的輔助函數
async function sendLineNotify(userId, fileInfo) {
    const message = `📄 檔案名稱: ${fileInfo.fileName}\n🔗 下載連結: ${fileInfo.fileUrl}`;
    await axios.post('https://api.line.me/v2/bot/message/push', {
        to: userId,
        messages: [{ type: 'text', text: message }]
    }, {
        headers: { 'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
    });
}

// 全局錯誤處理
app.use((err, req, res, next) => {
    console.error('全局錯誤:', err);
    res.status(500).json({ success: false, error: '服務器內部錯誤', message: err.message });
});

// 404 處理
app.use('*', (req, res) => {
    res.status(404).json({ success: false, error: '找不到資源', path: req.originalUrl });
});

// 啟動服務器
app.listen(port, () => {
    console.log(`🚀 服務器啟動成功：http://localhost:${port}`);
});

