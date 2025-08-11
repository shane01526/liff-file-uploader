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

// ============= 發送通知到 LINE Bot 和 N8N =============

/**
 * 發送檔案上傳通知到 LINE Bot（觸發 n8n webhook）
 */
async function sendNotificationToLineBot(userId, fileInfo) {
  try {
    console.log('📨 準備發送通知到 LINE Bot');
    
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('⚠️ N8N_WEBHOOK_URL 未設定，跳過發送通知');
      return false;
    }

    // 構造 LINE webhook 格式的訊息事件
    const messageData = {
      type: 'message',
      timestamp: Date.now(),
      source: {
        type: 'user',
        userId: userId || 'anonymous_user'
      },
      message: {
        id: `msg_${Date.now()}`,
        type: 'text',
        text: `📎 檔案上傳完成\n📄 檔名：${fileInfo.fileName}\n💾 大小：${(fileInfo.fileSize / 1024 / 1024).toFixed(2)} MB\n🔗 下載：${fileInfo.downloadUrl}\n⏰ 時間：${new Date(fileInfo.uploadTime).toLocaleString('zh-TW')}`
      },
      replyToken: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      // 額外的檔案資訊
      fileData: {
        originalName: fileInfo.fileName,
        savedName: fileInfo.savedName,
        fileSize: fileInfo.fileSize,
        downloadUrl: fileInfo.downloadUrl,
        uploadTime: fileInfo.uploadTime
      }
    };

    console.log('🎯 發送到 N8N Webhook:', webhookUrl);
    console.log('💬 訊息內容:', messageData.message.text);

    // 發送到 n8n webhook
    const response = await axios.post(webhookUrl, messageData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'File-Uploader/1.0',
        'X-Source': 'file-upload-notification'
      },
      timeout: 15000
    });

    console.log('✅ 成功觸發 N8N Webhook！');
    console.log('📊 回應狀態:', response.status);
    
    return true;

  } catch (error) {
    console.error('❌ 發送通知到 N8N 失敗:', error.message);
    if (error.response) {
      console.error('📄 錯誤回應:', error.response.status, error.response.data);
    }
    return false;
  }
}

/**
 * 發送 LINE 推播訊息（可選）
 */
async function sendLineMessage(userId, message) {
  try {
    if (process.env.SEND_LINE_NOTIFICATION !== 'true') {
      console.log('ℹ️ LINE 推播已停用（SEND_LINE_NOTIFICATION=false）');
      return false;
    }

    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN 未設定');
      return false;
    }

    const response = await axios.post(
      'https://api.line.me/v2/bot/message/push',
      {
        to: userId,
        messages: [{
          type: 'text',
          text: message
        }]
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('✅ LINE 推播發送成功');
    return true;

  } catch (error) {
    console.error('❌ LINE 推播發送失敗:', error.message);
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
    n8nWebhook: process.env.N8N_WEBHOOK_URL ? '已設定' : '未設定',
    lineNotification: process.env.SEND_LINE_NOTIFICATION || 'false'
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
      console.log('📊 檔案資訊:', {
        原始檔名: req.file.originalname,
        儲存檔名: req.file.filename,
        檔案大小: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`
      });

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

      const userId = req.body.userId;
      
      // 1. 發送通知到 N8N（觸發您的 workflow）
      console.log('🚀 開始觸發 N8N workflow...');
      const n8nTriggered = await sendNotificationToLineBot(userId, fileInfo);
      result.n8nTriggered = n8nTriggered;
      
      if (n8nTriggered) {
        console.log('🎉 N8N Webhook 觸發成功！您的 workflow 應該已經開始執行');
      } else {
        console.warn('⚠️ N8N Webhook 觸發失敗，請檢查 N8N_WEBHOOK_URL 設定');
      }

      // 2. 選擇性發送 LINE 推播
      if (userId && process.env.SEND_LINE_NOTIFICATION === 'true') {
        console.log('📱 發送 LINE 推播給用戶:', userId);
        const lineMessage = `📎 您的檔案「${fileInfo.fileName}」已成功上傳！\n📥 系統正在處理中，請稍候...`;
        const lineSent = await sendLineMessage(userId, lineMessage);
        result.lineSent = lineSent;
      } else {
        result.lineSent = false;
      }

      console.log('🏁 檔案處理完成:', {
        檔案: fileInfo.fileName,
        'N8N觸發': n8nTriggered ? '✅' : '❌',
        'LINE推播': result.lineSent ? '✅' : '⏸️'
      });

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

// 測試 N8N webhook 觸發
app.post('/api/test-n8n', async (req, res) => {
  try {
    const { userId } = req.body;
    
    console.log('🧪 測試 N8N Webhook 觸發');
    
    // 建立測試檔案資訊
    const testFileInfo = {
      fileName: 'test-resume.pdf',
      savedName: `${Date.now()}-test-resume.pdf`,
      fileSize: 1024000, // 1MB
      downloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/test-resume.pdf`,
      uploadTime: new Date().toISOString()
    };
    
    const n8nTriggered = await sendNotificationToLineBot(userId || 'test_user', testFileInfo);
    
    res.json({
      success: n8nTriggered,
      message: n8nTriggered ? 'N8N Webhook 觸發成功！' : 'N8N Webhook 觸發失敗',
      webhookUrl: process.env.N8N_WEBHOOK_URL,
      testFileInfo: testFileInfo
    });
    
  } catch (error) {
    console.error('❌ 測試 N8N 觸發失敗:', error);
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
  console.log(`🎯 N8N Webhook: ${process.env.N8N_WEBHOOK_URL || '未設定'}`);
  console.log(`📲 LINE 推播: ${process.env.SEND_LINE_NOTIFICATION || 'false'}`);
  console.log('================================');
  console.log('✨ 系統功能：');
  console.log('   📤 檔案上傳 ➜ 觸發 N8N Webhook ➜ 啟動您的 workflow');
  console.log('   📱 可選的 LINE 推播通知');
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
