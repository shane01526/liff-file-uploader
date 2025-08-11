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
console.log('🤖 N8N Webhook URL:', process.env.N8N_WEBHOOK_URL || '未設定');

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

// ============= 模擬用戶訊息發送到 N8N Webhook =============

/**
 * 模擬用戶發送包含檔案資訊的訊息到 LINE Bot
 * 這個函數會建構一個模擬的 LINE Webhook 事件，包含檔案下載連結
 */
async function simulateUserMessageToBot(userId, fileInfo) {
  try {
    console.log('🎭 模擬用戶發送檔案訊息到 LINE Bot');
    console.log('📄 檔案資訊:', fileInfo);

    // 構造模擬的 LINE Webhook 事件結構
    const simulatedLineEvent = {
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
            id: `mock_msg_${Date.now()}`,
            type: 'text',
            text: `檔案上傳完成: ${fileInfo.fileName}\n下載連結: ${fileInfo.downloadUrl}`
          },
          replyToken: `mock_reply_${Date.now()}`,
          // 自定義資料 - 包含完整檔案資訊
          customData: {
            action: 'file_uploaded',
            fileInfo: fileInfo,
            source: 'liff_upload_system',
            timestamp: new Date().toISOString()
          }
        }
      ],
      destination: process.env.LINE_BOT_USER_ID || 'mock_line_bot'
    };

    console.log('📤 準備發送到 N8N Webhook:', JSON.stringify(simulatedLineEvent, null, 2));

    // 發送到 N8N Webhook
    const webhookSuccess = await sendToN8NWebhook(simulatedLineEvent);
    
    // 如果有設定 LINE Bot Token，也可以選擇性發送真實通知
    let lineNotificationSent = false;
    if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.SEND_LINE_NOTIFICATION === 'true') {
      lineNotificationSent = await sendLineNotification(userId, fileInfo);
    }

    return {
      webhookSent: webhookSuccess,
      lineNotificationSent: lineNotificationSent,
      simulatedEvent: simulatedLineEvent
    };

  } catch (error) {
    console.error('❌ 模擬用戶訊息失敗:', error);
    return {
      webhookSent: false,
      lineNotificationSent: false,
      error: error.message
    };
  }
}

/**
 * 發送模擬事件到 N8N Webhook
 */
async function sendToN8NWebhook(eventData) {
  try {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    
    if (!webhookUrl) {
      console.warn('⚠️ N8N_WEBHOOK_URL 環境變數未設定，跳過 webhook 發送');
      return false;
    }

    console.log('🔗 發送到 N8N Webhook:', webhookUrl);

    const response = await axios.post(webhookUrl, eventData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LIFF-File-Uploader/1.0',
        // 可以加入驗證標頭
        'X-Source': 'liff-upload-system',
        'X-Timestamp': Date.now().toString()
      },
      timeout: 10000 // 10秒超時
    });

    console.log('✅ N8N Webhook 回應:', response.status, response.data);
    return true;

  } catch (error) {
    console.error('❌ 發送到 N8N Webhook 失敗:', error.response?.data || error.message);
    return false;
  }
}

/**
 * 發送 LINE 通知（選用功能）
 */
async function sendLineNotification(userId, fileInfo) {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('⚠️ LINE Token 未設定，跳過 LINE 通知');
      return false;
    }

    const message = {
      type: 'template',
      altText: `📄 檔案 ${fileInfo.fileName} 上傳完成！`,
      template: {
        type: 'buttons',
        thumbnailImageUrl: 'https://img.icons8.com/fluency/96/file.png',
        imageAspectRatio: 'rectangle',
        imageSize: 'cover',
        title: '📄 檔案上傳成功',
        text: `檔案：${fileInfo.fileName.length > 40 ? fileInfo.fileName.substring(0, 40) + '...' : fileInfo.fileName}\n大小：${(fileInfo.fileSize / 1024 / 1024).toFixed(2)} MB\n上傳時間：${new Date(fileInfo.uploadTime).toLocaleString('zh-TW')}`,
        actions: [
          {
            type: 'uri',
            label: '📥 下載檔案',
            uri: fileInfo.downloadUrl
          },
          {
            type: 'postback',
            label: '📋 檔案資訊',
            data: JSON.stringify({
              action: 'file_info',
              fileName: fileInfo.fileName,
              fileSize: fileInfo.fileSize,
              downloadUrl: fileInfo.downloadUrl
            }),
            displayText: '顯示檔案詳細資訊'
          }
        ]
      }
    };

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [message]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ LINE 通知發送成功');
    return true;

  } catch (error) {
    console.error('❌ LINE 通知發送失敗:', error.response?.data || error.message);
    return false;
  }
}

// ============= API 路由 =============

// 健康檢查
app.get('/api/health', (req, res) => {
  console.log('❤️ 健康檢查');
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT,
    uploadDir: uploadDir,
    lineToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定',
    n8nWebhook: process.env.N8N_WEBHOOK_URL ? '已設定' : '未設定'
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

// 檔案上傳 API - 整合模擬用戶訊息功能
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

      // 準備檔案資訊
      const fileInfo = {
        fileName: req.file.originalname,
        savedName: req.file.filename,
        fileSize: req.file.size,
        downloadUrl: downloadUrl,
        uploadTime: new Date().toISOString(),
        mimeType: req.file.mimetype,
        fileExtension: path.extname(req.file.originalname)
      };

      const result = {
        success: true,
        ...fileInfo
      };

      // 取得用戶 ID
      const userId = req.body.userId;
      
      if (userId) {
        console.log('👤 用戶 ID:', userId);
        console.log('🎭 開始模擬用戶訊息到 LINE Bot');
        
        // 模擬用戶發送訊息到 LINE Bot/N8N
        const simulationResult = await simulateUserMessageToBot(userId, fileInfo);
        
        // 將模擬結果加入回應
        result.simulation = simulationResult;
        
        if (simulationResult.webhookSent) {
          console.log('🎉 成功模擬用戶訊息並發送到 N8N!');
        } else {
          console.warn('⚠️ 模擬訊息發送失敗');
        }
        
      } else {
        console.warn('⚠️ 沒有提供 userId，跳過模擬用戶訊息');
        result.simulation = {
          webhookSent: false,
          lineNotificationSent: false,
          error: '沒有提供 userId'
        };
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
app.post('/api/test-simulation', async (req, res) => {
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
      uploadTime: new Date().toISOString(),
      mimeType: 'application/pdf',
      fileExtension: '.pdf'
    };
    
    const result = await simulateUserMessageToBot(userId, testFileInfo);
    
    res.json({
      success: true,
      message: '測試模擬用戶訊息完成',
      result: result,
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

// 接收 N8N 或其他系統的回調 (選用)
app.post('/api/callback', (req, res) => {
  console.log('📨 收到回調請求:', JSON.stringify(req.body, null, 2));
  
  // 處理來自 N8N 或其他系統的回調
  // 例如：檔案處理完成的通知
  
  res.json({
    status: 'received',
    timestamp: new Date().toISOString()
  });
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
  console.log(`🔗 N8N Webhook: ${process.env.N8N_WEBHOOK_URL || '未設定'}`);
  console.log(`🎭 User Message Simulation: 已啟用`);
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
