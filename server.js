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
app.use(express.static('dist'));

// 檢查必要的環境變數
if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.error('❌ 錯誤: LINE_CHANNEL_ACCESS_TOKEN 未設置');
    process.exit(1);
} else {
    console.log('✅ LINE_CHANNEL_ACCESS_TOKEN 已設置');
}

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

// 原有的 API（保持向後兼容）
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
        console.error('上傳錯誤:', error);
        res.status(500).json({ error: error.message });
    }
});

// 新增：前端期望的履歷上傳 API
app.post('/api/upload-resume', upload.single('file'), async (req, res) => {
    try {
        console.log('📄 收到履歷上傳請求');
        
        if (!req.file) {
            return res.status(400).json({ error: '沒有文件上傳' });
        }

        const fileUrl = `${req.protocol}://${req.get('host')}/api/download/${req.file.filename}`;
        
        console.log('✅ 文件上傳成功:', {
            originalName: req.file.originalname,
            filename: req.file.filename,
            size: req.file.size,
            fileUrl
        });

        res.json({
            success: true,
            fileName: req.file.originalname,
            fileUrl,
            fileSize: req.file.size,
            uploadTime: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ 履歷上傳錯誤:', error);
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

// 原有的通知 API（保持向後兼容）
app.post('/api/notify', async (req, res) => {
    try {
        const { userId, fileInfo } = req.body;
        console.log('📱 發送 LINE 通知給用戶:', userId);
        
        const response = await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{
                type: 'text',
                text: `履歷上傳成功！\n檔案: ${fileInfo.fileName}\n大小: ${formatFileSize(fileInfo.fileSize)}\n下載: ${fileInfo.fileUrl}`
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ LINE 通知發送成功');
        res.json({ success: true, messageId: response.data });
    } catch (error) {
        console.error('❌ LINE 通知發送失敗:', error.response?.data || error.message);
        res.status(500).json({ 
            error: error.message,
            details: error.response?.data 
        });
    }
});

// 新增：前端期望的 LINE 通知 API
app.post('/api/line-notification', async (req, res) => {
    try {
        console.log('📱 收到 LINE 通知請求:', req.body);
        
        const { userId, action, fileInfo } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: '缺少 userId' });
        }

        let message = '';
        
        if (action === 'resume_uploaded') {
            message = `📋 履歷上傳完成！

📄 檔案名稱: ${fileInfo.fileName}
📊 檔案大小: ${formatFileSize(fileInfo.fileSize)}
🔗 下載連結: ${fileInfo.fileUrl}
⏰ 上傳時間: ${new Date(fileInfo.uploadTime).toLocaleString('zh-TW')}

✅ 我們已收到您的履歷，將盡快為您處理！`;
        } else {
            message = '收到您的訊息，謝謝！';
        }

        console.log('準備發送訊息給用戶:', userId);
        console.log('訊息內容:', message);

        const response = await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{
                type: 'text',
                text: message
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10秒超時
        });
        
        console.log('✅ LINE 通知發送成功, Response:', response.status);
        res.json({ 
            success: true, 
            messageId: response.data,
            sentTo: userId 
        });
        
    } catch (error) {
        console.error('❌ LINE 通知發送失敗:');
        console.error('錯誤訊息:', error.message);
        
        if (error.response) {
            console.error('HTTP 狀態:', error.response.status);
            console.error('回應資料:', error.response.data);
            
            // 檢查常見錯誤
            if (error.response.status === 400) {
                console.error('可能原因: userId 格式錯誤或 Channel Access Token 無效');
            } else if (error.response.status === 401) {
                console.error('可能原因: Channel Access Token 無效或過期');
            } else if (error.response.status === 403) {
                console.error('可能原因: Bot 沒有權限發送訊息給該用戶');
            }
        }
        
        res.status(500).json({ 
            error: 'LINE 通知發送失敗',
            details: error.response?.data || error.message,
            userId: req.body.userId
        });
    }
});

// 輔助函數：格式化文件大小
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 健康檢查端點
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        hasLineToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN 
    });
});

// 測試 LINE API 連接
app.get('/api/test-line', async (req, res) => {
    try {
        // 測試 Bot Info API
        const response = await axios.get('https://api.line.me/v2/bot/info', {
            headers: {
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
            }
        });
        
        res.json({ 
            success: true, 
            botInfo: response.data 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.response?.data 
        });
    }
});

app.listen(port, () => {
    console.log(`🚀 服務器運行在 port ${port}`);
    console.log(`📱 LINE Token 狀態: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '✅ 已設置' : '❌ 未設置'}`);
});
