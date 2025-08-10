const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 允許跨域請求
app.use(cors());

// 靜態檔案（前端 index.html）
app.use(express.static(path.join(__dirname, 'public')));

// 建立 uploads 資料夾
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer 上傳設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// 健康檢查 API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 上傳 API
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: '沒有檔案' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    fileName: req.file.filename,
    fileUrl
  });
});

// 靜態提供 uploads
app.use('/uploads', express.static(uploadDir));

// 啟動 server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

