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
  allowedHeaders: ['Content-Type', 'Authorization', 'x-line-userid']
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

// LINE Bot 訊息發送
async function sendLineMessage(userId, message) {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('⚠️ LINE Token 未設定');
      return false;
    }

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [{ type: 'text', text: message }]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ LINE 訊息發送成功');
    return true;
  } catch (error) {
    console.error('❌ LINE 訊息發送失敗:', error.response?.data || error.message);
    return false;
  }
}

// ===== API 路由 =====

// 健康檢查 - 最重要的路由
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

// 檔案上傳 API
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

      const result = {
        success: true,
        fileName: req.file.originalname,
        savedName: req.file.filename,
        fileSize: req.file.size,
        uploadTime: new Date().toISOString()
      };

      // 發送 LINE 訊息
      const userId = req.body.userId;
      if (userId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        const message = `✅ 履歷上傳成功！\n\n檔案：${req.file.originalname}\n大小：${(req.file.size / 1024 / 1024).toFixed(2)} MB\n時間：${new Date().toLocaleString('zh-TW')}`;
        result.lineSent = await sendLineMessage(userId, message);
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

// 列出檔案
app.get('/api/files', (req, res) => {
  try {
    if (!fs.existsSync(uploadDir)) {
      return res.json({ files: [] });
    }
    
    const files = fs.readdirSync(uploadDir).map(filename => {
      const filePath = path.join(uploadDir, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        size: stats.size,
        uploadTime: stats.birthtime
      };
    });
    
    res.json({ files });
  } catch (error) {
    console.error('❌ 列出檔案錯誤:', error);
    res.status(500).json({ error: '無法列出檔案' });
  }
});

// 靜態檔案服務
app.use('/uploads', express.static(uploadDir));

// 提供前端檔案
app.use(express.static(__dirname));

// 根路由
app.get('/', (req, res) => {
  console.log('🏠 根路由請求');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Catch-all 路由 (在所有其他路由之後)
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
