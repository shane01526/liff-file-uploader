require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

// 中介軟體設定
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 確保上傳目錄存在
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 設定 - 檔案上傳處理
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // 生成唯一檔名
        const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
        const extension = path.extname(file.originalname);
        cb(null, `resume-${uniqueSuffix}${extension}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB
    },
    fileFilter: (req, file, cb) => {
        // 檢查檔案類型
        const allowedTypes = /pdf|doc|docx/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('只允許 PDF, DOC, DOCX 格式的檔案'));
        }
    }
});

// API 路由 1: 檔案上傳
app.post('/api/upload-resume', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '沒有上傳檔案' });
        }

        const fileInfo = {
            fileName: req.file.originalname,
            savedFileName: req.file.filename,
            fileSize: req.file.size,
            filePath: req.file.path,
            fileUrl: `${process.env.FRONTEND_URL}/api/download/${req.file.filename}`,
            uploadTime: req.body.uploadTime || new Date().toISOString(),
            userId: req.body.userId
        };

        console.log('檔案上傳成功:', fileInfo);

        res.json({
            success: true,
            message: '檔案上傳成功',
            fileUrl: fileInfo.fileUrl,
            fileName: fileInfo.fileName,
            fileSize: fileInfo.fileSize
        });

    } catch (error) {
        console.error('檔案上傳錯誤:', error);
        res.status(500).json({ error: error.message });
    }
});

// API 路由 2: 檔案下載
app.get('/api/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ error: '檔案不存在' });
    }
});

// API 路由 3: 發送 LINE 通知
app.post('/api/line-notification', async (req, res) => {
    try {
        const { userId, action, fileInfo } = req.body;

        if (!userId) {
            return res.status(400).json({ error: '缺少使用者 ID' });
        }

        // 準備要發送的訊息
        const message = {
            to: userId,
            messages: [
                {
                    type: 'text',
                    text: `🎉 履歷上傳成功通知\n\n📄 檔案名稱: ${fileInfo.fileName}\n📊 檔案大小: ${formatFileSize(fileInfo.fileSize)}\n⏰ 上傳時間: ${new Date(fileInfo.uploadTime).toLocaleString('zh-TW')}\n🔗 下載連結: ${fileInfo.fileUrl}\n\n✅ 我們已收到您的履歷，將盡快為您處理！`
                },
                {
                    type: 'template',
                    altText: '履歷處理選項',
                    template: {
                        type: 'buttons',
                        thumbnailImageUrl: 'https://via.placeholder.com/1024x1024/d4c4b0/ffffff?text=Resume',
                        title: '履歷已上傳完成',
                        text: '請選擇後續動作',
                        actions: [
                            {
                                type: 'uri',
                                label: '下載履歷',
                                uri: fileInfo.fileUrl
                            },
                            {
                                type: 'postback',
                                label: '查看處理狀態',
                                data: `action=check_status&file=${fileInfo.fileName}`
                            },
                            {
                                type: 'postback',
                                label: '重新上傳',
                                data: 'action=reupload'
                            }
                        ]
                    }
                }
            ]
        };

        // 呼叫 LINE Messaging API
        const lineResponse = await axios.post('https://api.line.me/v2/bot/message/push', message, {
            headers: {
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('LINE 訊息發送成功:', lineResponse.data);

        res.json({
            success: true,
            message: 'LINE 通知發送成功',
            lineResponse: lineResponse.data
        });

    } catch (error) {
        console.error('LINE 通知發送失敗:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'LINE 通知發送失敗',
            details: error.response?.data || error.message 
        });
    }
});

// API 路由 4: Webhook 處理 (接收 LINE 事件)
app.post('/api/line-webhook', (req, res) => {
    try {
        const signature = req.headers['x-line-signature'];
        const body = JSON.stringify(req.body);
        
        // 驗證 signature
        const channelSecret = process.env.LINE_CHANNEL_SECRET;
        const hash = crypto.createHmac('SHA256', channelSecret).update(body).digest('base64');
        
        if (hash !== signature) {
            return res.status(403).json({ error: 'Signature 驗證失敗' });
        }

        // 處理 LINE 事件
        const events = req.body.events;
        events.forEach(event => {
            console.log('收到 LINE 事件:', event);
            
            if (event.type === 'postback') {
                handlePostback(event);
            } else if (event.type === 'message' && event.message.type === 'text') {
                handleTextMessage(event);
            }
        });

        res.status(200).json({ message: 'OK' });

    } catch (error) {
        console.error('Webhook 處理錯誤:', error);
        res.status(500).json({ error: error.message });
    }
});

// 處理 Postback 事件
async function handlePostback(event) {
    const data = event.postback.data;
    const userId = event.source.userId;
    
    console.log(`用戶 ${userId} 的 postback:`, data);
    
    if (data.includes('check_status')) {
        // 處理查看狀態的請求
        await sendLineMessage(userId, '您的履歷正在處理中，預計 24 小時內完成審核！');
    } else if (data === 'action=reupload') {
        // 處理重新上傳的請求
        await sendLineMessage(userId, '請點選以下連結重新上傳履歷：\n' + process.env.FRONTEND_URL);
    }
}

// 處理文字訊息
async function handleTextMessage(event) {
    const message = event.message.text;
    const userId = event.source.userId;
    
    if (message.includes('履歷') || message.includes('上傳')) {
        await sendLineMessage(userId, `請點選以下連結上傳您的履歷：\n${process.env.FRONTEND_URL}`);
    }
}

// 發送 LINE 訊息的輔助函數
async function sendLineMessage(userId, text) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{
                type: 'text',
                text: text
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('發送 LINE 訊息失敗:', error.response?.data || error.message);
    }
}

// 檔案大小格式化函數
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 啟動服務器
app.listen(port, () => {
    console.log(`服務器運行在 http://localhost:${port}`);
    console.log('LINE Channel Access Token:', process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定');
    console.log('LINE LIFF ID:', process.env.LINE_LIFF_ID ? '已設定' : '未設定');
});
