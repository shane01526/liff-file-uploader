const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const libre = require('libreoffice-convert');
const pdfPoppler = require('pdf-poppler');

// 載入環境變數
if (fs.existsSync('.env')) {
  require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 建立 uploads 資料夾
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer 設定
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) cb(null, true);
    else cb(new Error('不支援的檔案格式'));
  }
});

// ============= 工具函數 =============
async function convertToPdf(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ext = '.pdf';
    const fileData = fs.readFileSync(inputPath);
    libre.convert(fileData, ext, undefined, (err, done) => {
      if (err) return reject(err);
      fs.writeFileSync(outputPath, done);
      resolve(outputPath);
    });
  });
}

async function pdfToImages(pdfPath, outputDir) {
  const opts = {
    format: 'png',
    out_dir: outputDir,
    out_prefix: path.basename(pdfPath, '.pdf'),
    page: null
  };
  await pdfPoppler.convert(pdfPath, opts);
  return fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.png'))
    .map(f => path.join(outputDir, f));
}

// 這是你原本的通知功能
async function sendNotificationToLineBot(userId, fileInfo) {
  try {
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) return false;
    const messageData = {
      type: 'message',
      timestamp: Date.now(),
      source: { type: 'user', userId: userId || 'anonymous_user' },
      message: {
        id: `msg_${Date.now()}`,
        type: 'text',
        text: `📎 檔案上傳完成\n📄 檔名：${fileInfo.fileName}\n💾 大小：${(fileInfo.fileSize / 1024 / 1024).toFixed(2)} MB\n🔗 PDF下載：${fileInfo.pdfUrl}\n⏰ 時間：${new Date(fileInfo.uploadTime).toLocaleString('zh-TW')}`
      },
      fileData: fileInfo
    };
    await axios.post(webhookUrl, messageData, { headers: { 'Content-Type': 'application/json' } });
    return true;
  } catch {
    return false;
  }
}

// 上傳 API
app.post('/api/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ success: false, error: err.message });
      if (!req.file) return res.status(400).json({ success: false, error: '沒有收到檔案' });

      const baseUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;

      // Step 1: 確保是 PDF
      let pdfPath = path.join(uploadDir, req.file.filename);
      const ext = path.extname(pdfPath).toLowerCase();
      if (ext !== '.pdf') {
        const pdfFileName = `${Date.now()}-${path.basename(req.file.filename, ext)}.pdf`;
        pdfPath = path.join(uploadDir, pdfFileName);
        await convertToPdf(path.join(uploadDir, req.file.filename), pdfPath);
      }

      // Step 2: PDF 轉圖片
      const imageDirName = `${Date.now()}_images`;
      const imageDir = path.join(uploadDir, imageDirName);
      fs.mkdirSync(imageDir, { recursive: true });
      const imagePaths = await pdfToImages(pdfPath, imageDir);

      // Step 3: 建立下載連結
      const pdfUrl = `${baseUrl}/uploads/${path.basename(pdfPath)}`;
      const imageUrls = imagePaths.map(p => `${baseUrl}/uploads/${imageDirName}/${path.basename(p)}`);

      const fileInfo = {
        fileName: req.file.originalname,
        fileSize: req.file.size,
        pdfUrl,
        imageUrls,
        uploadTime: new Date().toISOString()
      };

      // Step 4: 發送通知
      const n8nTriggered = await sendNotificationToLineBot(req.body.userId, fileInfo);

      res.json({
        success: true,
        ...fileInfo,
        n8nTriggered
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
});

// 靜態檔案
app.use('/uploads', express.static(uploadDir));
app.use(express.static(__dirname));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
