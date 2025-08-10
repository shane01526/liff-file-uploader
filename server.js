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

// 🚀 直接發送檔案資訊到 n8n webhook
async function sendToN8nWebhook(userId, fileName, downloadUrl, fileSize, filePath) {
  try {
    if (!process.env.N8N_WEBHOOK_URL) {
      console.warn('⚠️ N8N_WEBHOOK_URL 未設定');
      return { success: false, error: 'N8N webhook URL 未設定' };
    }

    console.log('📤 發送檔案資訊到 n8n:', process.env.N8N_WEBHOOK_URL);
    
    const payload = {
      // 基本檔案資訊
      userId: userId,
      fileName: fileName,
      downloadUrl: downloadUrl,
      fileSize: fileSize,
      filePath: filePath,
      uploadTime: new Date().toISOString(),
      
      // 檔案詳細資訊
      fileExtension: path.extname(fileName).toLowerCase(),
      fileSizeFormatted: `${(fileSize / 1024 / 1024).toFixed(2)} MB`,
      
      // 系統資訊
      messageType: 'file_upload_completed',
      source: 'liff_file_uploader',
      timestamp: Date.now(),
      
      // 可選：使用者資訊 (如果你需要)
      userInfo: {
        platform: 'LINE',
        uploadSource: 'LIFF_Web_App'
      }
    };

    const response = await axios.post(process.env.N8N_WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'X-Custom-Source': 'file-upload-system',
        'X-Webhook-Type': 'file_analysis',
        'User-Agent': 'LIFF-File-Uploader/1.0'
      },
      timeout: 15000 // 15秒超時
    });
    
    console.log('✅ n8n webhook 觸發成功:', response.status);
    console.log('📝 n8n 回應:', response.data);
    
    return { 
      success: true, 
      responseStatus: response.status,
      responseData: response.data 
    };
    
  } catch (error) {
    console.error('❌ n8n webhook 發送失敗:', error.message);
    console.error('📍 錯誤詳情:', error.response?.data || error);
    
    return { 
      success: false, 
      error: error.message,
      statusCode: error.response?.status,
      responseData: error.response?.data
    };
  }
}

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
        thumbnailImageUrl: 'https://i.imgur.com/8QmD2Kt.png', // 可選：檔案圖示
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
    
    // 如果 PostBack 訊息失敗，發送簡單文字訊息作為備用
    try {
      await sendSimpleLineMessage(userId, `✅ ${fileName} 上傳成功！\n\n📥 下載連結：\n${downloadUrl}\n\n大小：${(fileSize / 1024 / 1024).toFixed(2)} MB`);
      return true;
    } catch (backupError) {
      console.error('❌ 備用訊息也發送失敗:', backupError.message);
      return false;
    }
  }
}

// 簡單文字訊息發送（備用）
async function sendSimpleLineMessage(userId, text) {
  await axios.post('https://api.line.me/v2/bot/message/push', {
    to: userId,
    messages: [{ type: 'text', text: text }]
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

// 🆕 增強的 LINE Webhook 處理，支援模擬事件識別
app.post('/api/webhook', async (req, res) => {
  const isSimulated = req.headers['x-simulated-event'] === 'true';
  
  console.log('📨 收到 LINE Webhook:', isSimulated ? '(模擬)' : '(真實)', JSON.stringify(req.body, null, 2));
  
  try {
    const events = req.body.events || [];
    
    for (const event of events) {
      // 處理文字訊息 (包含模擬的檔案上傳訊息)
      if (event.type === 'message' && event.message.type === 'text') {
        const messageText = event.message.text;
        
        // 檢查是否為檔案上傳相關訊息
        if (messageText.includes('檔案上傳完成') || messageText.includes('#檔案分析')) {
          console.log('📄 檢測到檔案上傳訊息:', messageText);
          
          // 這裡你可以添加自己的處理邏輯
          // 例如：解析檔案資訊、觸發分析流程等
          
          if (isSimulated) {
            console.log('🤖 這是模擬的使用者訊息，可以觸發你的 n8n 流程');
          }
          
          // 可選：回應確認訊息
          if (event.replyToken && !isSimulated) {
            await replyToLineMessage(event.replyToken, '✅ 檔案訊息已收到，開始進行分析...');
          }
        }
      }
      
      // 處理 PostBack 事件
      if (event.type === 'postback') {
        console.log('🔄 處理 PostBack:', event.postback.data);
        
        const userId = event.source.userId;
        const postbackData = JSON.parse(event.postback.data);
        
        switch (postbackData.action) {
          case 'copy_link':
            // 發送連結文字訊息方便複製
            await sendSimpleLineMessage(userId, 
              `📋 下載連結已準備好：\n\n${postbackData.url}\n\n檔案：${postbackData.fileName}\n\n長按上方連結可複製到剪貼簿`
            );
            break;
            
          case 'delete_file':
            if (postbackData.confirm) {
              // 處理檔案刪除
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

// 🆕 LINE 回應訊息函數
async function replyToLineMessage(replyToken, text) {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('⚠️ LINE Token 未設定，無法回應');
      return false;
    }

    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ LINE 回應訊息發送成功');
    return true;
  } catch (error) {
    console.error('❌ LINE 回應訊息失敗:', error.response?.data || error.message);
    return false;
  }
}

// 檔案刪除處理
async function handleFileDelete(userId, fileName) {
  try {
    // 找到對應的檔案
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

// 🆕 簡化的檔案上傳 API - 直接發送到 n8n
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

      const userId = req.body.userId;

      // 🚀 直接發送到 n8n webhook 進行分析
      if (userId && process.env.N8N_WEBHOOK_URL) {
        console.log('📤 發送檔案資訊到 n8n 進行分析...');
        const n8nResult = await sendToN8nWebhook(
          userId, 
          req.file.originalname, 
          downloadUrl, 
          req.file.size,
          req.file.path
        );
        
        result.n8nSent = n8nResult.success;
        result.n8nResponse = n8nResult.responseData;
        
        if (!n8nResult.success) {
          result.n8nError = n8nResult.error;
          console.warn('⚠️ n8n webhook 失敗，但檔案上傳成功');
        }
      } else if (!process.env.N8N_WEBHOOK_URL) {
        console.warn('⚠️ N8N_WEBHOOK_URL 未設定，跳過 n8n 通知');
        result.n8nSkipped = 'N8N_WEBHOOK_URL not configured';
      }

      // 可選：發送 LINE 通知給使用者
      if (userId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        console.log('📱 發送成功通知給使用者:', userId);
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
  console.log(`🤖 n8n Webhook: ${process.env.N8N_WEBHOOK_URL || '未設定'}`);
  console.log('🔧 設定 N8N_WEBHOOK_URL 環境變數來啟用檔案分析功能');
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
