require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 10000;

// 中介軟體
app.use(cors());
app.use(express.json());
app.use(express.static('dist')); // 服務 Vite 建構的文件

// 上傳設定
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        cb(extname ? null : new Error('只允許 PDF, DOC, DOCX'), extname);
    }
});

// API 路由
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '沒有文件' });
        }

        const fileUrl = `${req.protocol}://${req.get('host')}/api/download/${req.file.filename}`;
        
        res.json({
            success: true,
            fileName: req.file.originalname,
            fileUrl,
            fileSize: req.file.size
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/download/:filename', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: '文件不存在' });
    }
});

// 發送 LINE 通知
app.post('/api/notify', async (req, res) => {
    try {
        const { userId, fileInfo } = req.body;
        
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{
                type: 'text',
                text: `履歷上傳成功！\n檔案: ${fileInfo.fileName}\n大小: ${fileInfo.fileSize}\n下載: ${fileInfo.fileUrl}`
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
            }
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`服務器運行在 port ${port}`);
});
