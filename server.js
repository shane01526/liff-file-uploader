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

// ============= 新增：模擬用戶 PostBack 功能 =============

// 模擬用戶發送 PostBack 到自己的 Webhook
async function simulateUserPostbackToWebhook(userId, downloadUrl, fileName, fileSize) {
  try {
    console.log('🎭 模擬用戶發送 PostBack 訊息到 Webhook');
    
    // 構造模擬的 LINE Webhook 事件
    const mockWebhookEvent = {
      events: [
        {
          type: 'postback',
          mode: 'active',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: userId
          },
          postback: {
            data: JSON.stringify({
              action: 'file_uploaded',
              fileName: fileName,
              downloadUrl: downloadUrl,
              fileSize: fileSize,
              uploadTime: new Date().toISOString(),
              source: 'file_upload_system'
            }),
            params: {}
          },
          replyToken: 'mock_reply_token_' + Date.now()
        }
      ],
      destination: process.env.LINE_BOT_USER_ID || 'mock_destination'
    };

    console.log('📤 模擬 Webhook 事件:', JSON.stringify(mockWebhookEvent, null, 2));
    
    // 直接調用 Webhook 處理函數
    await processSimulatedWebhookEvent(mockWebhookEvent);
    
    return true;
  } catch (error) {
    console.error('❌ 模擬 PostBack 失敗:', error);
    return false;
  }
}

// 處理模擬的 Webhook 事件
async function processSimulatedWebhookEvent(webhookData) {
  try {
    console.log('🔄 處理模擬的 Webhook 事件');
    
    const events = webhookData.events || [];
    
    for (const event of events) {
      const userId = event.source.userId;
      
      if (event.type === 'postback') {
        console.log('📨 處理模擬 PostBack:', event.postback.data);
        
        const postbackData = JSON.parse(event.postback.data);
        
        switch (postbackData.action) {
          case 'file_uploaded':
            await handleUserFileUploadEvent(userId, postbackData);
            break;
            
          default:
            console.log('❓ 未知的模擬 PostBack 動作:', postbackData.action);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ 處理模擬 Webhook 事件失敗:', error);
  }
}

// 處理用戶檔案上傳事件（你的業務邏輯）
async function handleUserFileUploadEvent(userId, data) {
  try {
    console.log(`👤 模擬：用戶 ${userId} 上傳了檔案: ${data.fileName}`);
    console.log('📊 檔案資訊:', {
      fileName: data.fileName,
      fileSize: `${(data.fileSize / 1024 / 1024).toFixed(2)} MB`,
      downloadUrl: data.downloadUrl,
      uploadTime: data.uploadTime
    });
    
    // 🎯 在這裡添加你的業務邏輯
    // 例如：記錄到資料庫、發送通知、觸發其他系統等
    
    // 如果設定了 LINE Token，回應給用戶
    if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      await sendLineMessage(userId, 
        `✅ 收到您上傳的檔案「${data.fileName}」\n\n` +
        `📊 檔案大小: ${(data.fileSize / 1024 / 1024).toFixed(2)} MB\n` +
        `🕐 上傳時間: ${new Date(data.uploadTime).toLocaleString('zh-TW')}\n\n` +
        `🤖 系統正在處理您的檔案...`
      );
      
      // 模擬處理完成通知
      setTimeout(async () => {
        await sendLineMessage(userId, 
          `🎉 檔案「${data.fileName}」處理完成！\n\n` +
          `📥 下載連結: ${data.downloadUrl}`
        );
      }, 3000);
    }
    
  } catch (error) {
    console.error('❌ 處理用戶檔案上傳事件失敗:', error);
  }
}

// 發送 LINE 訊息的輔助函數
async function sendLineMessage(userId, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [{ type: 'text', text: message }]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('📤 LINE 訊息已發送');
  } catch (error) {
    console.error('❌ 發送 LINE 訊息失敗:', error.response?.data || error.message);
  }
}

// ============= 原有的 LINE Bot 功能 =============

// LINE Bot 訊息發送函數 - 支援 PostBack 按鈕
async function sendLineDownloadMessage(userId, fileName, downloadUrl, fileSize) {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('⚠️ LINE Token 未設定');
      return false;
    }

    // 建立帶有下載按鈕的訊息
    const message = {
      type: 'template',
      altText: `✅ ${fileName} 上傳成功！點擊下載檔案`,
      template: {
        type: 'buttons',
        thumbnailImageUrl: 'https://i.imgur.com/8QmD2Kt.png',
        imageAspectRatio: 'rectangle',
        imageSize: 'cover',
        imageBackgroundColor: '#F5F3F0',
        title: '📄 檔案上傳成功',
        text: `檔案：${fileName.length > 30 ? fileName.substring(0, 30) + '...' : fileName}\n大小：${(fileSize / 1024 / 1024).toFixed(2)} MB\n時間：${new Date().toLocaleString('zh-TW')}`,
        actions: [
          {
            type: 'uri',
            label: '📥 下載檔案',
            uri: downloadUrl
          },
          {
            type: 'postback',
            label: '📋 複製連結',
            data: JSON.stringify({
              action: 'copy_link',
              url: downloadUrl,
              fileName: fileName
            }),
            displayText: '已複製下載連結'
          },
          {
            type: 'postback',
            label: '🗑️ 刪除檔案',
            data: JSON.stringify({
              action: 'delete_file',
              fileName: fileName,
              confirm: true
            }),
            displayText: '確認刪除檔案？'
          }
        ]
      }
    };

    const response = await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [message]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ LINE PostBack 訊息發送成功');
    return true;
  } catch (error) {
    console.error('❌ LINE 訊息發送失敗:', error.response?.data || error.message);
    return false;
  }
}

// 簡單文字訊息發送（備用）
async function sendSimpleLineMessage(userId, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('❌ 發送簡單訊息失敗:', error.response?.data || error.message);
  }
}

// 檔案刪除處理
async function handleFileDelete(userId, fileName) {
  try {
    const files = fs.readdirSync(uploadDir);
    const targetFile = files.find(file => file.includes(fileName.replace(/\.[^/.]+$/, "")));
    
    if (targetFile) {
      const filePath = path.join(uploadDir, targetFile);
      fs.unlinkSync(filePath);
      
      await sendSimpleLineMessage(userId, `🗑️ 檔案 "${fileName}" 已成功刪除`);
      console.log('🗑️ 檔案已刪除:', targetFile);
    } else {
      await sendSimpleLineMessage(userId, `❌ 找不到檔案 "${fileName}"，可能已經被刪除`);
    }
    
  } catch (error) {
    console.error('❌ 刪除檔案錯誤:', error);
    await sendSimpleLineMessage(userId, `❌ 刪除檔案時發生錯誤：${error.message}`);
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
    lineToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定'
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

// LINE Webhook 處理 PostBack 事件
app.post('/api/webhook', async (req, res) => {
  console.log('📨 收到 LINE Webhook:', JSON.stringify(req.body, null, 2));
  
  try {
    const events = req.body.events || [];
    
    for (const event of events) {
      if (event.type === 'postback') {
        console.log('🔄 處理 PostBack:', event.postback.data);
        
        const userId = event.source.userId;
        const postbackData = JSON.parse(event.postback.data);
        
        switch (postbackData.action) {
          case 'copy_link':
            await sendSimpleLineMessage(userId, 
              `📋 下載連結已準備好：\n\n${postbackData.url}\n\n檔案：${postbackData.fileName}\n\n長按上方連結可複製到剪貼簿`
            );
            break;
            
          case 'delete_file':
            if (postbackData.confirm) {
              await handleFileDelete(userId, postbackData.fileName);
            }
            break;
            
          default:
            console.log('❓ 未知的 PostBack 動作:', postbackData.action);
        }
      }
    }
    
    res.status(200).json({ status: 'ok' });
    
  } catch (error) {
    console.error('❌ Webhook 處理錯誤:', error);
    res.status(200).json({ status: 'error' }); // LINE 需要 200 回應
  }
});

// 檔案上傳 API - 修改版本，加入模擬 PostBack
app.post('/api/upload', (req, res) => {
  console.log('📤 上傳請求');
  
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

      const result = {
        success: true,
        fileName: req.file.originalname,
        savedName: req.file.filename,
        fileSize: req.file.size,
        downloadUrl: downloadUrl,
        uploadTime: new Date().toISOString()
      };

      // 🎭 模擬用戶發送 PostBack 到 Webhook
      const userId = req.body.userId;
      if (userId) {
        console.log('🎭 開始模擬用戶 PostBack');
        result.webhookSimulated = await simulateUserPostbackToWebhook(
          userId, 
          downloadUrl, 
          req.file.originalname, 
          req.file.size
        );
      }

      // 原有的 LINE 訊息發送（可選）
      if (userId && process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.SEND_ORIGINAL_MESSAGE === 'true') {
        console.log('📱 發送原有的 LINE 訊息');
        result.lineSent = await sendLineDownloadMessage(
          userId, 
          req.file.originalname, 
          downloadUrl, 
          req.file.size
        );
      }

      res.json(result);

    } catch (error) {
      console.error('❌ 處理錯誤:', error);
      res.status(500).json({ 
        success: false, 
        error: '伺服器錯誤' 
      });
    }
  });
});

// 檔案下載 API
app.get('/api/download/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(uploadDir, filename);
    
    console.log('📥 下載請求:', filename);
    
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
    
    // 取得原始檔名（去掉時間戳）
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

// 列出檔案
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

// 測試模擬 PostBack API
app.post('/api/simulate-postback', async (req, res) => {
  try {
    const { userId, fileName, downloadUrl, fileSize } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: '需要 userId' });
    }
    
    console.log('🧪 手動測試模擬 PostBack');
    
    const result = await simulateUserPostbackToWebhook(
      userId, 
      downloadUrl || 'https://example.com/test.pdf',
      fileName || 'test.pdf',
      fileSize || 1024000
    );
    
    res.json({ 
      success: result, 
      message: result ? '模擬 PostBack 成功' : '模擬 PostBack 失敗'
    });
    
  } catch (error) {
    console.error('❌ 測試模擬 PostBack 失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// 靜態檔案服務（保留舊的 uploads 路由作為備用）
app.use('/uploads', express.static(uploadDir));

// 提供前端檔案
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
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`📁 上傳目錄: ${uploadDir}`);
  console.log(`📱 LINE Token: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定'}`);
  console.log(`🔗 Webhook URL: ${process.env.FRONTEND_URL || 'http://localhost:' + PORT}/api/webhook`);
  console.log(`🎭 模擬 PostBack: 已啟用`);
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
