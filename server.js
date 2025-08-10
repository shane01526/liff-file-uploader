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
app.use(express.static('.')); // 直接服務當前目錄的 index.html

// 詳細的請求日誌
app.use((req, res, next) => {
    console.log(`📍 ${new Date().toISOString()} - ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log('📦 Request body:', req.body);
    }
    next();
});

// 檢查必要的環境變數
console.log('🔧 檢查環境變數...');
if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    console.warn('⚠️ 警告: LINE_CHANNEL_ACCESS_TOKEN 未設置，LINE 通知功能將無法使用');
} else {
    console.log('✅ LINE_CHANNEL_ACCESS_TOKEN 已設置');
}

// 確保上傳目錄存在
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('📁 創建上傳目錄:', uploadDir);
}

// Multer 配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        console.log('📂 設置上傳目標目錄:', uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        console.log('📄 生成唯一檔名:', uniqueName);
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        console.log('🔍 檢查檔案類型:', file.originalname);
        const allowedTypes = /\.(pdf|doc|docx)$/i;
        const extname = allowedTypes.test(path.extname(file.originalname));
        
        if (extname) {
            console.log('✅ 檔案類型允許');
            cb(null, true);
        } else {
            console.log('❌ 檔案類型不允許');
            cb(new Error('只允許 PDF, DOC, DOCX 格式的檔案'), false);
        }
    }
});

// 主要上傳端點
app.post('/api/upload', (req, res) => {
    console.log('📤 收到文件上傳請求');
    console.log('📊 請求頭:', req.headers);
    
    upload.single('file')(req, res, (err) => {
        if (err) {
            console.error('❌ Multer 錯誤:', err);
            
            // 確保返回 JSON 格式的錯誤
            return res.status(400).json({
                success: false,
                error: err.message || '檔案上傳失敗',
                timestamp: new Date().toISOString()
            });
        }

        try {
            if (!req.file) {
                console.log('❌ 沒有收到檔案');
                return res.status(400).json({
                    success: false,
                    error: '沒有收到檔案',
                    timestamp: new Date().toISOString()
                });
            }

            console.log('✅ 檔案上傳成功:');
            console.log('  - 原檔名:', req.file.originalname);
            console.log('  - 儲存檔名:', req.file.filename);
            console.log('  - 檔案大小:', req.file.size);
            console.log('  - 存儲路徑:', req.file.path);

            const fileUrl = `${req.protocol}://${req.get('host')}/api/download/${req.file.filename}`;
            console.log('🔗 檔案下載連結:', fileUrl);

            const response = {
                success: true,
                fileName: req.file.originalname,
                fileUrl: fileUrl,
                fileSize: req.file.size,
                uploadTime: new Date().toISOString(),
                message: '檔案上傳成功'
            };

            console.log('📤 發送回應:', response);
            res.json(response);

        } catch (error) {
            console.error('❌ 處理上傳檔案時發生錯誤:', error);
            res.status(500).json({
                success: false,
                error: '處理檔案時發生內部錯誤',
                details: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
});

// 檔案下載端點
app.get('/api/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, uploadDir, filename);
    
    console.log('📥 檔案下載請求:', filename);
    console.log('📂 檔案路徑:', filePath);
    
    if (fs.existsSync(filePath)) {
        console.log('✅ 檔案存在，開始下載');
        res.download(filePath);
    } else {
        console.log('❌ 檔案不存在');
        res.status(404).json({
            success: false,
            error: '檔案不存在',
            filename: filename,
            timestamp: new Date().toISOString()
        });
    }
});

// LINE 通知端點
app.post('/api/notify', async (req, res) => {
    try {
        console.log('📱 收到 LINE 通知請求');
        console.log('📦 請求內容:', req.body);
        
        const { userId, fileInfo } = req.body;
        
        if (!userId) {
            console.log('❌ 缺少 userId');
            return res.status(400).json({
                success: false,
                error: '缺少用戶 ID',
                timestamp: new Date().toISOString()
            });
        }

        if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
            console.log('⚠️ LINE Token 未設置，跳過通知');
            return res.json({
                success: true,
                message: 'LINE Token 未設置，跳過通知',
                timestamp: new Date().toISOString()
            });
        }

        const message = `📋 履歷上傳完成！

📄 檔案名稱: ${fileInfo.fileName}
📊 檔案大小: ${formatFileSize(fileInfo.fileSize)}
🔗 下載連結: ${fileInfo.fileUrl}
⏰ 上傳時間: ${new Date(fileInfo.uploadTime).toLocaleString('zh-TW')}

✅ 我們已收到您的履歷，將盡快為您處理！`;

        console.log('📨 準備發送 LINE 訊息給用戶:', userId);
        console.log('📝 訊息內容:', message);

        const lineResponse = await axios.post('https://api.line.me/v2/bot/message/push', {
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
            timeout: 10000
        });
        
        console.log('✅ LINE 訊息發送成功');
        console.log('📊 LINE API 回應狀態:', lineResponse.status);
        
        res.json({
            success: true,
            message: 'LINE 通知發送成功',
            userId: userId,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ LINE 通知發送失敗:');
        console.error('錯誤類型:', error.name);
        console.error('錯誤訊息:', error.message);
        
        if (error.response) {
            console.error('HTTP 狀態:', error.response.status);
            console.error('回應資料:', error.response.data);
        }
        
        res.status(500).json({
            success: false,
            error: 'LINE 通知發送失敗',
            details: error.message,
            httpStatus: error.response?.status,
            timestamp: new Date().toISOString()
        });
    }
});

// 健康檢查
app.get('/api/health', (req, res) => {
    console.log('❤️ 健康檢查請求');
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        hasLineToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
        uploadDir: uploadDir,
        uploadDirExists: fs.existsSync(uploadDir)
    });
});

// 測試 LINE API
app.get('/api/test-line', async (req, res) => {
    console.log('🧪 LINE API 測試請求');
    
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        console.log('❌ LINE Token 未設置');
        return res.json({
            success: false,
            error: 'LINE_CHANNEL_ACCESS_TOKEN 未設置',
            hint: '請在 .env 文件中設置 LINE_CHANNEL_ACCESS_TOKEN'
        });
    }

    try {
        const response = await axios.get('https://api.line.me/v2/bot/info', {
            headers: {
                'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
            },
            timeout: 5000
        });
        
        console.log('✅ LINE API 連接成功');
        console.log('🤖 Bot 資訊:', response.data);
        
        res.json({
            success: true,
            message: 'LINE API 連接正常',
            botInfo: response.data,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ LINE API 測試失敗:', error.message);
        
        res.json({
            success: false,
            error: 'LINE API 連接失敗',
            details: error.message,
            httpStatus: error.response?.status,
            timestamp: new Date().toISOString()
        });
    }
});

// 錯誤處理中介軟體
app.use((error, req, res, next) => {
    console.error('💥 未處理的錯誤:', error);
    
    // 確保返回 JSON
    res.status(500).json({
        success: false,
        error: '服務器內部錯誤',
        message: error.message,
        timestamp: new Date().toISOString()
    });
});

// 404 處理
app.use('*', (req, res) => {
    console.log(`🔍 404 - 找不到: ${req.method} ${req.originalUrl}`);
    
    res.status(404).json({
        success: false,
        error: '找不到請求的資源',
        method: req.method,
        url: req.originalUrl,
        availableEndpoints: [
            'POST /api/upload',
            'GET /api/download/:filename',
            'POST /api/notify',
            'GET /api/health',
            'GET /api/test-line'
        ],
        timestamp: new Date().toISOString()
    });
});

// 輔助函數
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 啟動服務器
app.listen(port, (err) => {
    if (err) {
        console.error('❌ 服務器啟動失敗:', err);
        process.exit(1);
    }
    
    console.log('\n🚀 服務器啟動成功！');
    console.log(`📍 地址: http://localhost:${port}`);
    console.log(`📄 前端頁面: http://localhost:${port}/index.html`);
    console.log(`❤️ 健康檢查: http://localhost:${port}/api/health`);
    console.log(`🧪 LINE 測試: http://localhost:${port}/api/test-line`);
    console.log(`📁 上傳目錄: ${path.resolve(uploadDir)}`);
    console.log(`📱 LINE Token: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '✅ 已設置' : '❌ 未設置'}`);
    console.log('\n🛑 按 Ctrl+C 停止服務器\n');
});

// 優雅關閉
process.on('SIGINT', () => {
    console.log('\n🛑 正在關閉服務器...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 正在關閉服務器...');
    process.exit(0);
});
