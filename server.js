const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const sharp = require('sharp');
const { promisify } = require('util');

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

// 建立資料夾
const uploadDir = path.join(__dirname, 'uploads');
const pdfDir = path.join(__dirname, 'pdf');
const imagesDir = path.join(__dirname, 'images');

[uploadDir, pdfDir, imagesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 建立資料夾:`, dir);
  }
});

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

// ============= 文件轉換功能 =============

/**
 * 將 DOC/DOCX 轉換為 PDF
 */
async function convertToPDF(inputPath, outputPath) {
  try {
    const ext = path.extname(inputPath).toLowerCase();
    
    if (ext === '.pdf') {
      // 如果已經是 PDF，直接複製
      fs.copyFileSync(inputPath, outputPath);
      console.log('✅ PDF 檔案直接複製');
      return true;
    }
    
    console.log(`📄 開始轉換 ${ext} 到 PDF...`);
    
    if (ext === '.docx' || ext === '.doc') {
      // 使用 mammoth 將 Word 文檔轉換為 HTML，然後轉 PDF
      // 注意：這是一個簡化的轉換方案
      // 實際生產環境建議使用 LibreOffice 或其他專業轉換工具
      
      const mammoth = require('mammoth');
      const puppeteer = require('puppeteer');
      
      // 將 Word 轉為 HTML
      const result = await mammoth.convertToHtml({ path: inputPath });
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
            p { margin-bottom: 10px; }
          </style>
        </head>
        <body>
          ${result.value}
        </body>
        </html>
      `;
      
      // 使用 Puppeteer 將 HTML 轉為 PDF
      const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setContent(html);
      await page.pdf({ 
        path: outputPath,
        format: 'A4',
        margin: {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm'
        }
      });
      await browser.close();
      
      console.log('✅ Word 轉 PDF 完成');
      return true;
    }
    
    throw new Error(`不支援的檔案格式: ${ext}`);
    
  } catch (error) {
    console.error('❌ PDF 轉換失敗:', error.message);
    return false;
  }
}

/**
 * 將 PDF 轉換為圖片
 */
async function convertPDFToImages(pdfPath, outputDir) {
  try {
    console.log('🖼️ 開始將 PDF 轉換為圖片...');
    
    // 使用 pdf-poppler 將 PDF 轉換為圖片
    const poppler = require('pdf-poppler');
    
    const options = {
      format: 'png',
      out_dir: outputDir,
      out_prefix: path.basename(pdfPath, '.pdf'),
      page: null // 轉換所有頁面
    };
    
    // 轉換 PDF 為圖片
    const res = await poppler.convert(pdfPath, options);
    
    console.log(`✅ PDF 轉圖片完成，共 ${res.length || 1} 頁`);
    
    // 返回生成的圖片檔案列表
    const imageFiles = fs.readdirSync(outputDir)
      .filter(file => file.startsWith(options.out_prefix))
      .sort();
    
    return imageFiles;
    
  } catch (error) {
    console.error('❌ PDF 轉圖片失敗:', error.message);
    return [];
  }
}

/**
 * 使用備用方案：創建 PDF 縮圖
 */
async function createPDFThumbnail(pdfPath, outputPath) {
  try {
    console.log('🖼️ 使用備用方案創建 PDF 縮圖...');
    
    // 這裡使用一個簡化的方法
    // 實際上，您可能需要使用其他工具如 ImageMagick 或 pdf2pic
    
    // 為了演示，我們創建一個佔位圖片
    await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
    .png()
    .composite([{
      input: Buffer.from(`
        <svg width="800" height="600">
          <rect width="100%" height="100%" fill="white"/>
          <text x="400" y="300" text-anchor="middle" font-family="Arial" font-size="24" fill="#333">
            PDF 檔案縮圖
          </text>
          <text x="400" y="350" text-anchor="middle" font-family="Arial" font-size="16" fill="#666">
            檔案: ${path.basename(pdfPath)}
          </text>
        </svg>
      `),
      top: 0,
      left: 0
    }])
    .toFile(outputPath);
    
    console.log('✅ PDF 縮圖創建完成');
    return [path.basename(outputPath)];
    
  } catch (error) {
    console.error('❌ 創建 PDF 縮圖失敗:', error.message);
    return [];
  }
}

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

    // 構造包含轉換後檔案的訊息
    let messageText = `📎 檔案處理完成\n📄 原始檔名：${fileInfo.fileName}`;
    
    if (fileInfo.pdfUrl) {
      messageText += `\n📋 PDF 檔案：${fileInfo.pdfUrl}`;
    }
    
    if (fileInfo.imageUrls && fileInfo.imageUrls.length > 0) {
      messageText += `\n🖼️ 圖片檔案：${fileInfo.imageUrls.length} 張`;
      messageText += `\n🔗 第一張圖片：${fileInfo.imageUrls[0]}`;
    }
    
    messageText += `\n💾 大小：${(fileInfo.fileSize / 1024 / 1024).toFixed(2)} MB\n⏰ 時間：${new Date(fileInfo.uploadTime).toLocaleString('zh-TW')}`;

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
        text: messageText
      },
      replyToken: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      // 額外的檔案資訊
      fileData: {
        originalName: fileInfo.fileName,
        savedName: fileInfo.savedName,
        fileSize: fileInfo.fileSize,
        originalUrl: fileInfo.downloadUrl,
        pdfUrl: fileInfo.pdfUrl,
        imageUrls: fileInfo.imageUrls,
        uploadTime: fileInfo.uploadTime
      }
    };

    console.log('🎯 發送到 N8N Webhook:', webhookUrl);

    const response = await axios.post(webhookUrl, messageData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'File-Uploader/1.0',
        'X-Source': 'file-upload-notification'
      },
      timeout: 15000
    });

    console.log('✅ 成功觸發 N8N Webhook！');
    return true;

  } catch (error) {
    console.error('❌ 發送通知到 N8N 失敗:', error.message);
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
    pdfDir: pdfDir,
    imagesDir: imagesDir,
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
    timestamp: new Date().toISOString(),
    features: ['檔案上傳', 'PDF轉換', '圖片轉換', 'N8N整合']
  });
});

// 檔案上傳 API（增強版）
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
      
      const baseUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
      const originalUrl = `${baseUrl}/api/download/original/${req.file.filename}`;
      
      const fileInfo = {
        fileName: req.file.originalname,
        savedName: req.file.filename,
        fileSize: req.file.size,
        downloadUrl: originalUrl,
        uploadTime: new Date().toISOString()
      };

      // 步驟 1: 轉換為 PDF
      console.log('🔄 步驟 1: 開始轉換為 PDF...');
      const pdfFileName = `${Date.now()}-${path.parse(req.file.originalname).name}.pdf`;
      const pdfPath = path.join(pdfDir, pdfFileName);
      
      const pdfConverted = await convertToPDF(req.file.path, pdfPath);
      
      if (pdfConverted && fs.existsSync(pdfPath)) {
        fileInfo.pdfUrl = `${baseUrl}/api/download/pdf/${pdfFileName}`;
        console.log('✅ PDF 轉換成功');
      } else {
        console.warn('⚠️ PDF 轉換失敗，跳過圖片轉換');
        return res.json({
          success: false,
          error: 'PDF 轉換失敗'
        });
      }

      // 步驟 2: 將 PDF 轉換為圖片
      console.log('🔄 步驟 2: 開始轉換 PDF 為圖片...');
      const imageOutputDir = path.join(imagesDir, path.parse(pdfFileName).name);
      
      // 建立圖片輸出資料夾
      if (!fs.existsSync(imageOutputDir)) {
        fs.mkdirSync(imageOutputDir, { recursive: true });
      }
      
      let imageFiles = await convertPDFToImages(pdfPath, imageOutputDir);
      
      // 如果 PDF 轉圖片失敗，使用備用方案
      if (!imageFiles || imageFiles.length === 0) {
        console.log('🔄 使用備用方案創建縮圖...');
        const thumbnailPath = path.join(imageOutputDir, 'thumbnail.png');
        imageFiles = await createPDFThumbnail(pdfPath, thumbnailPath);
      }
      
      // 構建圖片 URL 列表
      if (imageFiles && imageFiles.length > 0) {
        fileInfo.imageUrls = imageFiles.map(imgFile => 
          `${baseUrl}/api/download/image/${path.parse(pdfFileName).name}/${imgFile}`
        );
        console.log(`✅ 圖片轉換成功，共 ${imageFiles.length} 張`);
      } else {
        console.warn('⚠️ 圖片轉換失敗');
        fileInfo.imageUrls = [];
      }

      const result = {
        success: true,
        message: '檔案處理完成',
        original: {
          fileName: fileInfo.fileName,
          downloadUrl: fileInfo.downloadUrl
        },
        pdf: {
          fileName: pdfFileName,
          downloadUrl: fileInfo.pdfUrl
        },
        images: {
          count: imageFiles ? imageFiles.length : 0,
          downloadUrls: fileInfo.imageUrls || []
        },
        ...fileInfo
      };

      const userId = req.body.userId;
      
      // 發送通知到 N8N
      console.log('🚀 觸發 N8N workflow...');
      const n8nTriggered = await sendNotificationToLineBot(userId, fileInfo);
      result.n8nTriggered = n8nTriggered;

      // 選擇性發送 LINE 推播
      if (userId && process.env.SEND_LINE_NOTIFICATION === 'true') {
        console.log('📱 發送 LINE 推播給用戶:', userId);
        let lineMessage = `📎 您的檔案「${fileInfo.fileName}」已處理完成！\n\n`;
        lineMessage += `📋 PDF 檔案已準備完成\n`;
        if (fileInfo.imageUrls && fileInfo.imageUrls.length > 0) {
          lineMessage += `🖼️ 已轉換為 ${fileInfo.imageUrls.length} 張圖片\n`;
        }
        lineMessage += `\n📥 請點擊連結下載檔案`;
        
        const lineSent = await sendLineMessage(userId, lineMessage);
        result.lineSent = lineSent;
      } else {
        result.lineSent = false;
      }

      console.log('🏁 檔案處理完成:', {
        原始檔案: fileInfo.fileName,
        PDF轉換: fileInfo.pdfUrl ? '✅' : '❌',
        圖片轉換: (fileInfo.imageUrls?.length || 0) + '張',
        'N8N觸發': n8nTriggered ? '✅' : '❌'
      });

      res.json(result);

    } catch (error) {
      console.error('❌ 處理錯誤:', error);
      res.status(500).json({ 
        success: false, 
        error: '檔案處理失敗: ' + error.message 
      });
    }
  });
});

// 原始檔案下載
app.get('/api/download/original/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);
  downloadFile(res, filePath, filename, '原始檔案');
});

// PDF 檔案下載
app.get('/api/download/pdf/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(pdfDir, filename);
  downloadFile(res, filePath, filename, 'PDF檔案');
});

// 圖片檔案下載
app.get('/api/download/image/:folder/:filename', (req, res) => {
  const folder = req.params.folder;
  const filename = req.params.filename;
  const filePath = path.join(imagesDir, folder, filename);
  downloadFile(res, filePath, filename, '圖片檔案');
});

// 通用檔案下載函數
function downloadFile(res, filePath, filename, type) {
  try {
    console.log(`📥 ${type}下載請求:`, filename);
    
    if (!fs.existsSync(filePath)) {
      console.log(`❌ ${type}不存在:`, filename);
      return res.status(404).json({ error: `${type}不存在` });
    }
    
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'application/octet-stream';
    
    switch (ext) {
      case '.pdf':
        contentType = 'application/pdf';
        break;
      case '.png':
        contentType = 'image/png';
        break;
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.doc':
        contentType = 'application/msword';
        break;
      case '.docx':
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        break;
    }
    
    const originalName = filename.replace(/^\d+-/, '');
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    
    console.log(`✅ 開始下載${type}:`, originalName);
    res.sendFile(filePath);
    
  } catch (error) {
    console.error(`❌ ${type}下載錯誤:`, error);
    res.status(500).json({ error: `${type}下載失敗` });
  }
}

// 列出所有檔案 API
app.get('/api/files', (req, res) => {
  try {
    const files = [];
    
    // 掃描上傳資料夾
    if (fs.existsSync(uploadDir)) {
      const uploadedFiles = fs.readdirSync(uploadDir);
      
      uploadedFiles.forEach(filename => {
        const filePath = path.join(uploadDir, filename);
        const stats = fs.statSync(filePath);
        const originalName = filename.replace(/^\d+-/, '');
        const baseName = path.parse(originalName).name;
        
        const fileInfo = {
          original: {
            filename: originalName,
            savedName: filename,
            size: stats.size,
            uploadTime: stats.birthtime,
            downloadUrl: `/api/download/original/${filename}`
          }
        };
        
        // 查找對應的 PDF
        const pdfFiles = fs.existsSync(pdfDir) ? fs.readdirSync(pdfDir) : [];
        const matchingPdf = pdfFiles.find(pdfFile => 
          pdfFile.includes(baseName) || pdfFile.includes(path.parse(filename).name)
        );
        
        if (matchingPdf) {
          fileInfo.pdf = {
            filename: matchingPdf,
            downloadUrl: `/api/download/pdf/${matchingPdf}`
          };
        }
        
        // 查找對應的圖片
        const imageFolder = path.join(imagesDir, baseName);
        if (fs.existsSync(imageFolder)) {
          const imageFiles = fs.readdirSync(imageFolder);
          fileInfo.images = imageFiles.map(imgFile => ({
            filename: imgFile,
            downloadUrl: `/api/download/image/${baseName}/${imgFile}`
          }));
        }
        
        files.push(fileInfo);
      });
    }
    
    res.json({ files });
  } catch (error) {
    console.error('❌ 列出檔案錯誤:', error);
    res.status(500).json({ error: '無法列出檔案' });
  }
});

// 靜態檔案服務
app.use('/uploads', express.static(uploadDir));
app.use('/pdf', express.static(pdfDir));
app.use('/images', express.static(imagesDir));
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
  console.log(`📋 PDF Directory: ${pdfDir}`);
  console.log(`🖼️ Images Directory: ${imagesDir}`);
  console.log(`📱 LINE Token: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定'}`);
  console.log(`🎯 N8N Webhook: ${process.env.N8N_WEBHOOK_URL || '未設定'}`);
  console.log('================================');
  console.log('✨ 系統功能：');
  console.log('   📤 檔案上傳 ➜ 轉換 PDF ➜ 產生圖片 ➜ 觸發 N8N');
  console.log('   📋 支援 DOC/DOCX → PDF 轉換');
  console.log('   🖼️ 支援 PDF → 圖片轉換');
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
