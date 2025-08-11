const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// 載入環境變數
if (fs.existsSync('.env')) {
  require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 10000;

console.log('🚀 啟動伺服器...');
console.log('📍 Port:', PORT);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

// 基本中介軟體
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-line-userid', 'x-line-signature']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 請求日誌
app.use((req, res, next) => {
  console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// 建立 uploads 資料夾
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('📁 建立 uploads 資料夾:', uploadDir);
}

// Multer 設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const uniqueName = `${timestamp}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const allowedExts = ['.pdf', '.doc', '.docx'];
    const fileExt = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(file.mimetype) || allowedExts.includes(fileExt)) {
      cb(null, true);
    } else {
      cb(new Error('不支援的檔案格式'));
    }
  }
});

// ============= 模擬用戶發送訊息到 LINE Bot =============

/**
 * 模擬用戶發送包含檔案下載連結的訊息到 LINE Bot
 * 這會觸發您的 n8n LINE webhook
 */
async function simulateUserMessageToLineBot(userId, fileInfo) {
  try {
    console.log('🎭 模擬用戶發送訊息到 LINE Bot');
    
    if (!process.env.LINE_BOT_WEBHOOK_URL) {
      console.warn('⚠️ LINE_BOT_WEBHOOK_URL 未設定，跳過模擬訊息');
      return false;
    }

    // 構造標準的 LINE Webhook 事件結構
    const lineWebhookEvent = {
      events: [
        {
          type: 'message',
          mode: 'active',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: userId
          },
          message: {
            id: `msg_${Date.now()}`,
            type: 'text',
            text: `檔案上傳完成：${fileInfo.fileName}\n下載連結：${fileInfo.downloadUrl}\n檔案大小：${(fileInfo.fileSize / 1024 / 1024).toFixed(2)} MB\n上傳時間：${new Date(fileInfo.uploadTime).toLocaleString('zh-TW')}`
          },
          replyToken: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }
      ],
      destination: process.env.LINE_BOT_USER_ID || 'your_line_bot_id'
    };

    console.log('📤 發送到 LINE Bot Webhook:', process.env.LINE_BOT_WEBHOOK_URL);
    console.log('💬 訊息內容:', lineWebhookEvent.events[0].message.text);

    // 發送到您的 LINE Bot webhook (n8n 會接收到)
    const response = await axios.post(process.env.LINE_BOT_WEBHOOK_URL, lineWebhookEvent, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Line-Webhook/1.0',
        'X-Line-Signature': 'simulated_signature', // 如果需要驗證，請實作正確的簽章
      },
      timeout: 10000
    });

    console.log('✅ 成功發送訊息到 LINE Bot，n8n 應該會收到觸發');
    console.log('📊 回應狀態:', response.status);
    
    return true;

  } catch (error) {
    console.error('❌ 發送訊息到 LINE Bot 失敗:', error.message);
    if (error.response) {
      console.error('📄 錯誤回應:', error.response.status, error.response.data);
    }
    return false;
  }
}

// ===== API 路由 =====

// 健康檢查
app.get('/api/health', (req, res) => {
  console.log('❤️ 健康檢查');
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT,
    uploadDir: uploadDir,
    lineToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定',
    lineBotWebhook: process.env.LINE_BOT_WEBHOOK_URL ? '已設定' : '未設定'
  });
});

// 測試 API
app.get('/api/test', (req, res) => {
  console.log('🧪 測試 API');
  res.json({ 
    message: '伺服器正常運作',
    timestamp: new Date().toISOString()
  });
});

// 檔案上傳 API
app.post('/api/upload', (req, res) => {
  console.log('📤 收到上傳請求');
  
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        console.error('❌ 上傳錯誤:', err.message);
        return res.status(400).json({ 
          success: false, 
          error: err.message 
        });
      }

      if (!req.file) {
        return res.status(400).json({ 
          success: false, 
          error: '沒有收到檔案' 
        });
      }

      console.log('✅ 檔案上傳成功:', req.file.originalname);

      // 建立下載 URL
      const baseUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
      const downloadUrl = `${baseUrl}/api/download/${req.file.filename}`;

      const fileInfo = {
        fileName: req.file.originalname,
        savedName: req.file.filename,
        fileSize: req.file.size,
        downloadUrl: downloadUrl,
        uploadTime: new Date().toISOString()
      };

      const result = {
        success: true,
        ...fileInfo
      };

      // 模擬用戶發送訊息到 LINE Bot
      const userId = req.body.userId;
      if (userId) {
        console.log('👤 用戶 ID:', userId);
        console.log('🎭 開始模擬用戶發送訊息到 LINE Bot');
        
        const messageSent = await simulateUserMessageToLineBot(userId, fileInfo);
        result.messageSentToBot = messageSent;
        
        if (messageSent) {
          console.log('🎉 成功模擬用戶訊息，您的 n8n workflow 應該會被觸發！');
        } else {
          console.warn('⚠️ 模擬訊息發送失敗，請檢查 LINE_BOT_WEBHOOK_URL 設定');
        }
      } else {
        console.warn('⚠️ 沒有提供 userId，跳過模擬訊息');
        result.messageSentToBot = false;
      }

      res.json(result);

    } catch (error) {
      console.error('❌ 處理錯誤:', error);
      res.status(500).json({ 
        success: false, 
        error: '伺服器處理錯誤: ' + error.message 
      });
    }
  });
});

// 檔案下載 API
app.get('/api/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);
    
    console.log('📥 檔案下載請求:', filename);
    
    if (!fs.existsSync(filePath)) {
      console.log('❌ 檔案不存在:', filename);
      return res.status(404).json({ error: '檔案不存在' });
    }
    
    // 設定適當的 Content-Type
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';
    
    switch (ext) {
      case '.pdf':
        contentType = 'application/pdf';
        break;
      case '.doc':
        contentType = 'application/msword';
        break;
      case '.docx':
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        break;
    }
    
    // 取得原始檔名
    const originalName = filename.replace(/^\d+-/, '');
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    
    console.log('✅ 開始下載:', originalName);
    res.sendFile(filePath);
    
  } catch (error) {
    console.error('❌ 下載錯誤:', error);
    res.status(500).json({ error: '下載失敗' });
  }
});

// 列出檔案 API
app.get('/api/files', (req, res) => {
  try {
    if (!fs.existsSync(uploadDir)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(uploadDir).map(filename => {
      const filePath = path.join(uploadDir, filename);
      const stats = fs.statSync(filePath);
      const originalName = filename.replace(/^\d+-/, '');
      
      return {
        filename: originalName,
        savedName: filename,
        size: stats.size,
        uploadTime: stats.birthtime,
        downloadUrl: `/api/download/${filename}`
      };
    });
    
    res.json({ files });
  } catch (error) {
    console.error('❌ 列出檔案錯誤:', error);
    res.status(500).json({ error: '無法列出檔案' });
  }
});

// 測試模擬訊息 API
app.post('/api/test-simulate', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: '需要提供 userId' });
    }
    
    console.log('🧪 測試模擬用戶訊息');
    
    // 建立測試檔案資訊
    const testFileInfo = {
      fileName: 'test-resume.pdf',
      savedName: `${Date.now()}-test-resume.pdf`,
      fileSize: 1024000, // 1MB
      downloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/test-resume.pdf`,
      uploadTime: new Date().toISOString()
    };
    
    const messageSent = await simulateUserMessageToLineBot(userId, testFileInfo);
    
    res.json({
      success: messageSent,
      message: messageSent ? '成功發送測試訊息到 LINE Bot' : '發送測試訊息失敗',
      testFileInfo: testFileInfo
    });
    
  } catch (error) {
    console.error('❌ 測試模擬訊息失敗:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 靜態檔案服務
app.use('/uploads', express.static(uploadDir));
app.use(express.static(__dirname));

// 根路由
app.get('/', (req, res) => {
  console.log('🏠 根路由請求');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Catch-all 路由
app.get('*', (req, res) => {
  console.log('🔍 未匹配路由:', req.url);
  if (req.url.startsWith('/api/')) {
    res.status(404).json({ error: 'API 路由不存在' });
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// 錯誤處理
app.use((err, req, res, next) => {
  console.error('❌ 全域錯誤:', err);
  res.status(500).json({ error: '伺服器錯誤' });
});

// 啟動伺服器
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('🎉 伺服器啟動成功！');
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  console.log(`📁 Upload Directory: ${uploadDir}`);
  console.log(`📱 LINE Token: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定'}`);
  console.log(`🤖 LINE Bot Webhook: ${process.env.LINE_BOT_WEBHOOK_URL || '未設定'}`);
  console.log(`🎭 模擬用戶訊息: 已啟用`);
  console.log('================================');
});

// 優雅關閉
process.on('SIGTERM', () => {
  console.log('📴 收到 SIGTERM，正在關閉伺服器...');
  server.close(() => {
    console.log('✅ 伺服器已關閉');
    process.exit(0);
  });
});
