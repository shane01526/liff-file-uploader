const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// 中介軟體設定
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 靜態檔案服務 - 修正路徑
app.use(express.static(__dirname));

// 建立 uploads 資料夾
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 上傳設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('📁 設定上傳目錄:', uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const uniqueName = `${timestamp}-${file.originalname}`;
    console.log('📝 生成檔案名稱:', uniqueName);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
  },
  fileFilter: (req, file, cb) => {
    console.log('🔍 檢查檔案類型:', file.mimetype, file.originalname);
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
      cb(new Error('不支援的檔案格式，請上傳 PDF、DOC 或 DOCX 檔案'));
    }
  }
});

// LINE Bot 訊息發送函數
async function sendLineMessage(userId, message) {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('⚠️ 未設定 LINE_CHANNEL_ACCESS_TOKEN');
      return false;
    }

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
      }
    });

    console.log('✅ LINE 訊息發送成功');
    return true;
  } catch (error) {
    console.error('❌ LINE 訊息發送失敗:', error.response?.data || error.message);
    return false;
  }
}

// API 路由

// 健康檢查
app.get('/api/health', (req, res) => {
  console.log('❤️ 健康檢查請求');
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT,
    uploadDir: uploadDir
  });
});

// 測試 API
app.get('/api/test', (req, res) => {
  console.log('🧪 測試 API 請求');
  res.json({ 
    message: '測試成功',
    server: 'running',
    timestamp: new Date().toISOString()
  });
});

// 檔案上傳 API
app.post('/api/upload', (req, res) => {
  console.log('📤 收到上傳請求');
  console.log('Headers:', req.headers);
  console.log('Content-Type:', req.headers['content-type']);
  
  upload.single('file')(req, res, async (err) => {
    try {
      // 處理上傳錯誤
      if (err instanceof multer.MulterError) {
        console.error('❌ Multer 錯誤:', err);
        let errorMsg = '上傳失敗';
        switch (err.code) {
          case 'LIMIT_FILE_SIZE':
            errorMsg = '檔案太大，請選擇小於 10MB 的檔案';
            break;
          case 'LIMIT_UNEXPECTED_FILE':
            errorMsg = '未預期的檔案欄位';
            break;
        }
        return res.status(400).json({ 
          success: false, 
          error: errorMsg,
          code: err.code 
        });
      }
      
      if (err) {
        console.error('❌ 上傳錯誤:', err);
        return res.status(400).json({ 
          success: false, 
          error: err.message 
        });
      }

      // 檢查是否有檔案
      if (!req.file) {
        console.error('❌ 沒有檔案');
        return res.status(400).json({ 
          success: false, 
          error: '沒有收到檔案' 
        });
      }

      console.log('✅ 檔案上傳成功:');
      console.log('  原始名稱:', req.file.originalname);
      console.log('  儲存名稱:', req.file.filename);
      console.log('  檔案大小:', req.file.size);
      console.log('  儲存路徑:', req.file.path);

      const fileUrl = `${process.env.FRONTEND_URL}/uploads/${req.file.filename}`;
      
      // 準備回傳資料
      const responseData = {
        success: true,
        fileName: req.file.originalname,
        savedName: req.file.filename,
        fileSize: req.file.size,
        fileUrl: fileUrl,
        uploadTime: new Date().toISOString()
      };

      console.log('📤 準備回傳:', responseData);

      // 發送 LINE 訊息（如果有設定）
      const userId = req.body.userId || req.headers['x-line-userid'];
      if (userId) {
        console.log('📱 發送 LINE 訊息給:', userId);
        const message = `✅ 履歷上傳成功！\n\n檔案名稱：${req.file.originalname}\n檔案大小：${(req.file.size / 1024 / 1024).toFixed(2)} MB\n上傳時間：${new Date().toLocaleString('zh-TW')}`;
        
        const sent = await sendLineMessage(userId, message);
        responseData.lineSent = sent;
      }

      // 確保回傳 JSON
      res.setHeader('Content-Type', 'application/json');
      res.json(responseData);

    } catch (error) {
      console.error('❌ 處理上傳時發生錯誤:', error);
      res.status(500).json({ 
        success: false, 
        error: '服務器內部錯誤: ' + error.message 
      });
    }
  });
});

// 列出上傳的檔案
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(uploadDir).map(filename => {
      const filePath = path.join(uploadDir, filename);
      const stats = fs.statSync(filePath);
      return {
        filename,
        size: stats.size,
        uploadTime: stats.birthtime,
        url: `/uploads/${filename}`
      };
    });
    
    res.json({ files });
  } catch (error) {
    console.error('❌ 列出檔案錯誤:', error);
    res.status(500).json({ error: '無法列出檔案' });
  }
});

// 靜態檔案服務 - uploads 資料夾
app.use('/uploads', express.static(uploadDir));

// 根路由 - 提供 index.html
app.get('/', (req, res) => {
  console.log('🏠 根路由請求');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 處理
app.use((req, res) => {
  console.log('❌ 404 - 找不到路由:', req.method, req.url);
  res.status(404).json({ 
    error: '找不到請求的資源',
    method: req.method,
    url: req.url 
  });
});

// 錯誤處理中介軟體
app.use((err, req, res, next) => {
  console.error('❌ 伺服器錯誤:', err);
  res.status(500).json({ 
    error: '伺服器內部錯誤',
    message: err.message 
  });
});

// 啟動伺服器
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 伺服器啟動成功!');
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`📁 上傳目錄: ${uploadDir}`);
  console.log(`📱 LINE Token: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定'}`);
  console.log('================================');
});
