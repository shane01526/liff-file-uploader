const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { promisify } = require('util');
process.env.PATH += ':/usr/local/bin';
process.env.PATH = process.env.PATH + ":/usr/bin:/usr/local/bin";


// 文件轉換相關模組
let libreOfficeConvert;
let pdf2pic;

// 動態載入轉換模組
const loadConversionModules = () => {
  try {
    libreOfficeConvert = require('libreoffice-convert');
    libreOfficeConvert.convertAsync = promisify(libreOfficeConvert.convert);
    console.log('✅ LibreOffice 轉換模組載入成功');
  } catch (error) {
    console.warn('⚠️ LibreOffice 轉換模組載入失敗:', error.message);
    console.warn('⚠️ 將跳過 DOC/DOCX 轉 PDF 功能');
  }

  try {
    pdf2pic = require('pdf2pic');
    console.log('✅ PDF2Pic 轉換模組載入成功');
  } catch (error) {
    console.warn('⚠️ PDF2Pic 轉換模組載入失敗:', error.message);
    console.warn('⚠️ 將跳過 PDF 轉圖片功能');
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
      throw new Error('LibreOffice 轉換模組未載入，無法轉換 DOC/DOCX 檔案');
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
      throw new Error('PDF2Pic 轉換模組未載入，無法轉換 PDF 為圖片');
    }

    // 確保輸出目錄存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseName = path.basename(pdfPath, '.pdf');
    const convert = pdf2pic.fromPath(pdfPath, {
      density: parseInt(process.env.PDF_CONVERT_DENSITY) || 200,
      saveFilename: baseName,
      savePath: outputDir,
      format: process.env.IMAGE_OUTPUT_FORMAT || "png",
      width: parseInt(process.env.IMAGE_OUTPUT_WIDTH) || 1200,
      height: parseInt(process.env.IMAGE_OUTPUT_HEIGHT) || 1600,
      convert: "convert"
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

    // 步驟 1: 一律轉換為 PDF
    pdfPath = path.join(pdfDir, `${timestamp}-${originalName}.pdf`);
    
    if (originalExt === '.pdf') {
      // 如果已經是 PDF，直接複製
      fs.copyFileSync(originalFile.path, pdfPath);
      console.log('📄 檔案已是 PDF 格式，複製到 PDF 目錄');
    } else {
      // DOC/DOCX 轉 PDF
      if (!libreOfficeConvert) {
        throw new Error('系統不支援 DOC/DOCX 轉換功能，請直接上傳 PDF 檔案');
      }
      await convertToPDF(originalFile.path, pdfPath);
    }

    // 步驟 2: PDF 轉圖片
    const imageOutputDir = path.join(imageDir, `${timestamp}-${originalName}`);
    let imageFiles = [];
    
    if (pdf2pic) {
      try {
        imageFiles = await convertPDFToImages(pdfPath, imageOutputDir);
      } catch (imageError) {
        console.warn('⚠️ 圖片轉換失敗，但 PDF 轉換成功:', imageError.message);
        // 如果圖片轉換失敗，至少還有 PDF
      }
    } else {
      console.warn('⚠️ PDF2Pic 模組未載入，跳過圖片轉換');
    }

    // 建立下載 URL
    const baseUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
    const pdfFileName = path.basename(pdfPath);
    const imageFolderName = path.basename(imageOutputDir);
    
    const result = {
      // PDF 檔案資訊
      pdfFile: {
        name: `${originalName}.pdf`,
        downloadUrl: `${baseUrl}/api/download/pdf/${pdfFileName}`,
        size: fs.statSync(pdfPath).size
      },
      // 圖片檔案資訊
      imageFiles: {
        count: imageFiles.length,
        downloadUrl: imageFiles.length > 0 ? `${baseUrl}/api/download/images/${imageFolderName}` : null,
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

// ============= N8N 通知功能 =============

/**
 * 發送轉換完成通知到 N8N，包含下載連結
 */
async function sendConversionResultToN8N(userId, fileInfo, conversionResult) {
  try {
    console.log('📨 發送轉換結果到 N8N');
    
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('⚠️ N8N_WEBHOOK_URL 未設定，跳過發送通知');
      return false;
    }

    // 構造發送給 N8N 的資料
    const n8nData = {
      type: 'file_conversion_completed',
      timestamp: Date.now(),
      userId: userId || 'anonymous_user',
      originalFile: {
        name: fileInfo.fileName,
        size: fileInfo.fileSize,
        uploadTime: fileInfo.uploadTime
      },
      // PDF 下載連結
      pdfDownloadUrl: conversionResult.pdfFile.downloadUrl,
      // 圖片下載連結 (如果有的話)
      imagesDownloadUrl: conversionResult.imageFiles.downloadUrl,
      conversionDetails: {
        pdfFileName: conversionResult.pdfFile.name,
        pdfSize: conversionResult.pdfFile.size,
        imageCount: conversionResult.imageFiles.count,
        processTime: conversionResult.processTime,
        // 個別圖片下載連結（如果需要的話）
        individualImages: conversionResult.imageFiles.files.map(img => ({
          page: img.page,
          downloadUrl: img.downloadUrl
        }))
      }
    };

    console.log('🎯 發送到 N8N 的資料:', {
      PDF: n8nData.pdfDownloadUrl,
      圖片: n8nData.imagesDownloadUrl || '無',
      圖片數量: n8nData.conversionDetails.imageCount
    });

    const response = await axios.post(webhookUrl, n8nData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'File-Converter/1.0',
        'X-Source': 'file-conversion-completed'
      },
      timeout: 15000
    });

    console.log('✅ N8N Webhook 觸發成功！');
    return true;

  } catch (error) {
    console.error('❌ 發送到 N8N 失敗:', error.message);
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
    features: {
      pdfUpload: true,
      docConversion: !!libreOfficeConvert,
      imageConversion: !!pdf2pic
    },
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

// 檔案上傳與轉換 API（加強錯誤處理）
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

      const originalExt = path.extname(req.file.originalname).toLowerCase();
      
      // 檢查是否支援該檔案格式
      if (originalExt !== '.pdf' && !libreOfficeConvert) {
        return res.status(400).json({
          success: false,
          error: '系統目前不支援 DOC/DOCX 轉換，請直接上傳 PDF 檔案'
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

      const userId = req.body.userId;
      
      // 發送轉換結果到 N8N
      console.log('🚀 發送轉換結果到 N8N...');
      const n8nSent = await sendConversionResultToN8N(userId, fileInfo, conversionResult);

      // 清理原始上傳檔案（可選）
      if (process.env.KEEP_ORIGINAL_FILES !== 'true') {
        try {
          fs.unlinkSync(req.file.path);
          console.log('🗑️ 已清理原始上傳檔案');
        } catch (cleanupError) {
          console.warn('⚠️ 清理原始檔案失敗:', cleanupError.message);
        }
      }

      // 簡化的成功回應（只給前端簡單確認）
      const result = {
        success: true,
        message: '檔案轉換完成',
        fileName: req.file.originalname,
        n8nNotified: n8nSent,
        conversions: {
          pdfGenerated: true,
          imagesGenerated: conversionResult.imageFiles.count > 0
        }
      };

      console.log('🏁 轉換流程完成:', {
        檔案: fileInfo.fileName,
        'PDF': conversionResult.pdfFile.name,
        '圖片數': conversionResult.imageFiles.count,
        'N8N通知': n8nSent ? '✅' : '❌'
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

// 下載路由
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
    const imageFiles = files.filter(f => f.toLowerCase().endsWith('.png') || f.toLowerCase().endsWith('.jpg'));
    
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

// 靜態檔案服務
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
  console.log(`   📄 DOC/DOCX → PDF: ${libreOfficeConvert ? '✅' : '❌ (只支援 PDF 上傳)'}`);
  console.log(`   🖼️ PDF → 圖片: ${pdf2pic ? '✅' : '❌ (只支援 PDF 下載)'}`);
  console.log(`🎯 N8N Webhook: ${process.env.N8N_WEBHOOK_URL || '未設定'}`);
  console.log('================================');
  
  if (!libreOfficeConvert) {
    console.log('⚠️ 注意：DOC/DOCX 轉換功能不可用');
    console.log('   使用者只能上傳 PDF 檔案');
  }
  
  if (!pdf2pic) {
    console.log('⚠️ 注意：PDF 轉圖片功能不可用');
    console.log('   只會提供 PDF 下載連結');
  }
  
  console.log('✨ 系統流程：');
  console.log('   📤 檔案上傳');
  console.log('   📄 轉換為 PDF (如果需要)');
  console.log('   🖼️ 轉換為圖片 (如果可用)');
  console.log('   🎯 發送下載連結到 N8N');
  console.log('   ✅ 回傳簡單確認給前端');
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
