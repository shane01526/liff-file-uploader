const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { promisify } = require('util');

// 文件轉換相關模組
let libreOfficeConvert;
let pdf2pic;

// 動態載入轉換模組
const loadConversionModules = () => {
  try {
    libreOfficeConvert = require('libre-office-convert');
    libreOfficeConvert.convertAsync = promisify(libreOfficeConvert.convert);
    console.log('✅ LibreOffice 轉換模組載入成功');
  } catch (error) {
    console.warn('⚠️ LibreOffice 轉換模組載入失敗:', error.message);
  }

  try {
    pdf2pic = require('pdf2pic');
    console.log('✅ PDF2Pic 轉換模組載入成功');
  } catch (error) {
    console.warn('⚠️ PDF2Pic 轉換模組載入失敗:', error.message);
  }
};

// 載入環境變數
if (fs.existsSync('.env')) {
  require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 10000;

console.log('🚀 啟動伺服器...');
console.log('📍 Port:', PORT);
console.log('🌍 Environment:', process.env.NODE_ENV || 'development');

// 載入轉換模組
loadConversionModules();

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

// 建立必要的資料夾
const uploadDir = path.join(__dirname, 'uploads');
const pdfDir = path.join(__dirname, 'pdfs');
const imageDir = path.join(__dirname, 'images');

[uploadDir, pdfDir, imageDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log('📁 建立資料夾:', dir);
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
    console.log('📄 開始轉換為 PDF:', path.basename(inputPath));
    
    if (!libreOfficeConvert) {
      throw new Error('LibreOffice 轉換模組未載入');
    }

    // 讀取原始檔案
    const inputBuffer = fs.readFileSync(inputPath);
    
    // 轉換為 PDF
    const pdfBuffer = await libreOfficeConvert.convertAsync(inputBuffer, '.pdf', undefined);
    
    // 寫入 PDF 檔案
    fs.writeFileSync(outputPath, pdfBuffer);
    
    console.log('✅ PDF 轉換完成:', path.basename(outputPath));
    return outputPath;
    
  } catch (error) {
    console.error('❌ PDF 轉換失敗:', error);
    throw error;
  }
}

/**
 * 將 PDF 轉換為圖片
 */
async function convertPDFToImages(pdfPath, outputDir) {
  try {
    console.log('🖼️ 開始將 PDF 轉換為圖片:', path.basename(pdfPath));
    
    if (!pdf2pic) {
      throw new Error('PDF2Pic 轉換模組未載入');
    }

    // 確保輸出目錄存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseName = path.basename(pdfPath, '.pdf');
    const convert = pdf2pic.fromPath(pdfPath, {
      density: 200,           // 解析度
      saveFilename: baseName,
      savePath: outputDir,
      format: "png",          // 輸出格式
      width: 1200,           // 寬度
      height: 1600           // 高度
    });

    // 轉換所有頁面
    const results = await convert.bulk(-1, { responseType: "image" });
    
    if (!results || results.length === 0) {
      throw new Error('PDF 轉換圖片失敗：沒有產生圖片檔案');
    }

    const imageFiles = results.map(result => result.path);
    console.log('✅ 圖片轉換完成:', imageFiles.length, '張圖片');
    
    return imageFiles;
    
  } catch (error) {
    console.error('❌ 圖片轉換失敗:', error);
    throw error;
  }
}

/**
 * 處理檔案轉換流程
 */
async function processFileConversion(originalFile) {
  try {
    const timestamp = Date.now();
    const originalName = path.parse(originalFile.originalname).name;
    const originalExt = path.extname(originalFile.originalname).toLowerCase();
    
    let pdfPath;
    let isPdfConverted = false;

    // 步驟 1: 轉換為 PDF（如果不是 PDF）
    if (originalExt === '.pdf') {
      // 如果已經是 PDF，直接複製到 PDF 目錄
      pdfPath = path.join(pdfDir, `${timestamp}-${originalName}.pdf`);
      fs.copyFileSync(originalFile.path, pdfPath);
      console.log('📄 檔案已是 PDF 格式，直接使用');
    } else {
      // DOC/DOCX 轉 PDF
      pdfPath = path.join(pdfDir, `${timestamp}-${originalName}.pdf`);
      await convertToPDF(originalFile.path, pdfPath);
      isPdfConverted = true;
    }

    // 步驟 2: PDF 轉圖片
    const imageOutputDir = path.join(imageDir, `${timestamp}-${originalName}`);
    const imageFiles = await convertPDFToImages(pdfPath, imageOutputDir);

    // 建立下載 URL
    const baseUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
    const pdfFileName = path.basename(pdfPath);
    const imageFolderName = path.basename(imageOutputDir);
    
    const result = {
      originalFile: {
        name: originalFile.originalname,
        size: originalFile.size,
        downloadUrl: `${baseUrl}/api/download/original/${originalFile.filename}`
      },
      pdfFile: {
        name: `${originalName}.pdf`,
        path: pdfPath,
        size: fs.statSync(pdfPath).size,
        downloadUrl: `${baseUrl}/api/download/pdf/${pdfFileName}`,
        isConverted: isPdfConverted
      },
      imageFiles: {
        count: imageFiles.length,
        folder: imageFolderName,
        downloadUrl: `${baseUrl}/api/download/images/${imageFolderName}`,
        files: imageFiles.map((filePath, index) => ({
          name: path.basename(filePath),
          page: index + 1,
          downloadUrl: `${baseUrl}/api/download/images/${imageFolderName}/${path.basename(filePath)}`
        }))
      },
      processTime: new Date().toISOString()
    };

    console.log('🎉 檔案轉換完成:', {
      '原檔': originalFile.originalname,
      'PDF': result.pdfFile.name,
      '圖片數量': result.imageFiles.count
    });

    return result;

  } catch (error) {
    console.error('❌ 檔案轉換流程失敗:', error);
    throw error;
  }
}

// ============= 發送通知功能（更新） =============

/**
 * 發送檔案處理完成通知到 N8N
 */
async function sendNotificationToLineBot(userId, fileInfo, conversionResult) {
  try {
    console.log('📨 準備發送轉換完成通知到 N8N');
    
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('⚠️ N8N_WEBHOOK_URL 未設定，跳過發送通知');
      return false;
    }

    // 構造包含轉換結果的通知訊息
    const notificationText = `📎 檔案處理完成！\n` +
      `📄 原檔：${fileInfo.fileName}\n` +
      `📋 PDF：${conversionResult.pdfFile.name} (${(conversionResult.pdfFile.size / 1024 / 1024).toFixed(2)} MB)\n` +
      `🖼️ 圖片：${conversionResult.imageFiles.count} 張\n` +
      `⏰ 處理時間：${new Date(conversionResult.processTime).toLocaleString('zh-TW')}\n` +
      `\n📥 下載連結：\n` +
      `• PDF：${conversionResult.pdfFile.downloadUrl}\n` +
      `• 圖片：${conversionResult.imageFiles.downloadUrl}`;

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
        text: notificationText
      },
      replyToken: `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      // 檔案轉換結果資料
      conversionData: {
        originalFile: fileInfo,
        conversionResult: conversionResult,
        completed: true
      }
    };

    console.log('🎯 發送轉換結果到 N8N Webhook');

    const response = await axios.post(webhookUrl, messageData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'File-Converter/1.0',
        'X-Source': 'file-conversion-notification'
      },
      timeout: 15000
    });

    console.log('✅ 成功觸發 N8N Webhook！轉換結果已發送');
    return true;

  } catch (error) {
    console.error('❌ 發送轉換通知到 N8N 失敗:', error.message);
    return false;
  }
}

/**
 * 發送 LINE 推播訊息（更新）
 */
async function sendLineMessage(userId, conversionResult) {
  try {
    if (process.env.SEND_LINE_NOTIFICATION !== 'true') {
      console.log('ℹ️ LINE 推播已停用');
      return false;
    }

    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN 未設定');
      return false;
    }

    const message = `🎉 檔案轉換完成！\n\n` +
      `📄 PDF 檔案：${conversionResult.pdfFile.name}\n` +
      `🖼️ 圖片：${conversionResult.imageFiles.count} 張\n\n` +
      `📥 點擊下載：\n${conversionResult.pdfFile.downloadUrl}`;

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
    directories: {
      upload: uploadDir,
      pdf: pdfDir,
      images: imageDir
    },
    modules: {
      libreOffice: !!libreOfficeConvert,
      pdf2pic: !!pdf2pic
    },
    lineToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定',
    n8nWebhook: process.env.N8N_WEBHOOK_URL ? '已設定' : '未設定'
  });
});

// 測試 API
app.get('/api/test', (req, res) => {
  console.log('🧪 測試 API');
  res.json({ 
    message: '文件轉換伺服器正常運作',
    timestamp: new Date().toISOString(),
    features: ['檔案上傳', 'PDF轉換', '圖片轉換']
  });
});

// 檔案上傳與轉換 API（主要更新）
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

      console.log('✅ 檔案上傳成功，開始轉換流程...');
      console.log('📊 檔案資訊:', {
        原始檔名: req.file.originalname,
        儲存檔名: req.file.filename,
        檔案大小: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`
      });

      // 執行檔案轉換流程
      console.log('🔄 開始檔案轉換...');
      const conversionResult = await processFileConversion(req.file);

      const fileInfo = {
        fileName: req.file.originalname,
        savedName: req.file.filename,
        fileSize: req.file.size,
        uploadTime: new Date().toISOString()
      };

      const result = {
        success: true,
        message: '檔案上傳並轉換完成',
        originalFile: fileInfo,
        conversion: conversionResult
      };

      const userId = req.body.userId;
      
      // 發送完成通知到 N8N
      console.log('🚀 發送轉換完成通知到 N8N...');
      const n8nTriggered = await sendNotificationToLineBot(userId, fileInfo, conversionResult);
      result.n8nTriggered = n8nTriggered;

      // 選擇性發送 LINE 推播
      if (userId && process.env.SEND_LINE_NOTIFICATION === 'true') {
        console.log('📱 發送 LINE 推播給用戶:', userId);
        const lineSent = await sendLineMessage(userId, conversionResult);
        result.lineSent = lineSent;
      } else {
        result.lineSent = false;
      }

      console.log('🏁 完整流程處理完成:', {
        檔案: fileInfo.fileName,
        'PDF檔': conversionResult.pdfFile.name,
        '圖片數': conversionResult.imageFiles.count,
        'N8N觸發': n8nTriggered ? '✅' : '❌',
        'LINE推播': result.lineSent ? '✅' : '⏸️'
      });

      res.json(result);

    } catch (error) {
      console.error('❌ 處理錯誤:', error);
      
      // 清理可能的部分檔案
      try {
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      } catch (cleanupError) {
        console.error('清理檔案失敗:', cleanupError);
      }
      
      res.status(500).json({ 
        success: false, 
        error: '檔案轉換處理錯誤: ' + error.message 
      });
    }
  });
});

// 下載路由（更新）
app.get('/api/download/original/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadDir, filename);
  downloadFile(res, filePath, '原始檔案');
});

app.get('/api/download/pdf/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(pdfDir, filename);
  downloadFile(res, filePath, 'PDF檔案');
});

app.get('/api/download/images/:folder', async (req, res) => {
  try {
    const folderName = req.params.folder;
    const folderPath = path.join(imageDir, folderName);
    
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: '圖片資料夾不存在' });
    }

    const files = fs.readdirSync(folderPath);
    const imageFiles = files.filter(f => f.toLowerCase().endsWith('.png'));
    
    res.json({
      folder: folderName,
      count: imageFiles.length,
      files: imageFiles.map((fileName, index) => ({
        name: fileName,
        page: index + 1,
        downloadUrl: `/api/download/images/${folderName}/${fileName}`
      }))
    });

  } catch (error) {
    console.error('❌ 列出圖片失敗:', error);
    res.status(500).json({ error: '無法存取圖片資料夾' });
  }
});

app.get('/api/download/images/:folder/:filename', (req, res) => {
  const folderName = req.params.folder;
  const filename = req.params.filename;
  const filePath = path.join(imageDir, folderName, filename);
  downloadFile(res, filePath, '圖片檔案');
});

// 統一下載函數
function downloadFile(res, filePath, fileType) {
  try {
    console.log(`📥 ${fileType}下載請求:`, path.basename(filePath));
    
    if (!fs.existsSync(filePath)) {
      console.log(`❌ ${fileType}不存在:`, path.basename(filePath));
      return res.status(404).json({ error: `${fileType}不存在` });
    }
    
    const ext = path.extname(filePath).toLowerCase();
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
    
    const filename = path.basename(filePath);
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    
    console.log(`✅ 開始下載${fileType}:`, filename);
    res.sendFile(filePath);
    
  } catch (error) {
    console.error(`❌ ${fileType}下載錯誤:`, error);
    res.status(500).json({ error: `${fileType}下載失敗` });
  }
}

// 測試轉換功能 API
app.post('/api/test-conversion', async (req, res) => {
  try {
    console.log('🧪 測試檔案轉換功能');
    
    const testResult = {
      modules: {
        libreOffice: !!libreOfficeConvert,
        pdf2pic: !!pdf2pic
      },
      directories: {
        upload: fs.existsSync(uploadDir),
        pdf: fs.existsSync(pdfDir),
        images: fs.existsSync(imageDir)
      },
      ready: !!libreOfficeConvert && !!pdf2pic
    };

    res.json({
      success: testResult.ready,
      message: testResult.ready ? '檔案轉換功能正常' : '檔案轉換功能未就緒',
      details: testResult
    });
    
  } catch (error) {
    console.error('❌ 測試轉換功能失敗:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 靜態檔案服務
app.use('/uploads', express.static(uploadDir));
app.use('/pdfs', express.static(pdfDir));
app.use('/images', express.static(imageDir));
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
  console.log('🎉 文件轉換伺服器啟動成功！');
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  console.log(`📁 資料夾:`);
  console.log(`   📤 上傳: ${uploadDir}`);
  console.log(`   📄 PDF: ${pdfDir}`);
  console.log(`   🖼️ 圖片: ${imageDir}`);
  console.log(`🔧 轉換功能:`);
  console.log(`   📄 DOC/DOCX → PDF: ${libreOfficeConvert ? '✅' : '❌'}`);
  console.log(`   🖼️ PDF → 圖片: ${pdf2pic ? '✅' : '❌'}`);
  console.log(`📱 LINE Token: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定'}`);
  console.log(`🎯 N8N Webhook: ${process.env.N8N_WEBHOOK_URL || '未設定'}`);
  console.log('================================');
  console.log('✨ 系統流程：');
  console.log('   📤 檔案上傳');
  console.log('   📄 轉換為 PDF');
  console.log('   🖼️ 轉換為圖片');
  console.log('   🎯 觸發 N8N Webhook');
  console.log('   📱 發送 LINE 通知（可選）');
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
