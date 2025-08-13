const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { promisify } = require('util');
const { exec } = require('child_process');

// 設定環境變數和路徑
process.env.PATH += ':/usr/local/bin:/usr/bin:/bin';
process.env.PATH = process.env.PATH + ":/usr/bin:/usr/local/bin";

// 文件轉換相關模組
let libreOfficeConvert;
let pdf2pic;

// 檢查系統工具是否可用
const checkSystemTools = async () => {
  const tools = ['gm', 'convert', 'identify', 'gs', 'libreoffice'];
  const results = {};
  
  for (const tool of tools) {
    try {
      await new Promise((resolve, reject) => {
        exec(`which ${tool}`, (error, stdout) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout.trim());
          }
        });
      });
      results[tool] = '✅ 可用';
    } catch (error) {
      results[tool] = '❌ 不可用';
    }
  }
  
  console.log('🔍 系統工具檢查:', results);
  return results;
};

// 動態載入轉換模組
const loadConversionModules = async () => {
  // 先檢查系統工具
  const systemTools = await checkSystemTools();
  
  try {
    libreOfficeConvert = require('libreoffice-convert');
    libreOfficeConvert.convertAsync = promisify(libreOfficeConvert.convert);
    console.log('✅ LibreOffice 轉換模組載入成功');
  } catch (error) {
    console.warn('⚠️ LibreOffice 轉換模組載入失敗:', error.message);
    console.warn('⚠️ 將跳過 DOC/DOCX 轉 PDF 功能');
  }

  try {
    // 檢查必要的二進位檔案
    if (systemTools.gm === '❌ 不可用' && systemTools.convert === '❌ 不可用') {
      throw new Error('GraphicsMagick 和 ImageMagick 都不可用');
    }
    
    pdf2pic = require('pdf2pic');
    console.log('✅ PDF2Pic 轉換模組載入成功');
    
    // 測試 PDF 轉換功能
    console.log('🧪 測試 PDF 轉換工具...');
    
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
 * 使用更強健的方式將 PDF 轉換為圖片
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
    
    // 嘗試不同的轉換配置
    const configs = [
      // 配置 1: 使用 convert (ImageMagick) - 修正檔名格式
      {
        density: parseInt(process.env.PDF_CONVERT_DENSITY) || 200,
        saveFilename: `${baseName}.%d`, // 使用 %d 格式，從 1 開始
        savePath: outputDir,
        format: process.env.IMAGE_OUTPUT_FORMAT || "png",
        width: parseInt(process.env.IMAGE_OUTPUT_WIDTH) || 1200,
        height: parseInt(process.env.IMAGE_OUTPUT_HEIGHT) || 1600,
        convert: "convert"
      },
      // 配置 2: 使用 gm (GraphicsMagick)
      {
        density: parseInt(process.env.PDF_CONVERT_DENSITY) || 150,
        saveFilename: `${baseName}.%d`,
        savePath: outputDir,
        format: "png",
        width: 1000,
        height: 1400,
        convert: "gm"
      }
    ];

    let results = null;
    let lastError = null;

    for (let i = 0; i < configs.length; i++) {
      try {
        console.log(`🔄 嘗試轉換配置 ${i + 1}...`);
        const convert = pdf2pic.fromPath(pdfPath, configs[i]);
        results = await convert.bulk(-1, { responseType: "image" });
        
        if (results && results.length > 0) {
          console.log(`✅ 配置 ${i + 1} 轉換成功!`);
          console.log('生成的檔案:', results.map(r => path.basename(r.path)));
          break;
        }
      } catch (error) {
        console.warn(`⚠️ 配置 ${i + 1} 轉換失敗:`, error.message);
        lastError = error;
        continue;
      }
    }

    if (!results || results.length === 0) {
      throw lastError || new Error('所有轉換配置都失敗了');
    }

    // 驗證生成的檔案是否實際存在
    const imageFiles = [];
    for (const result of results) {
      if (fs.existsSync(result.path)) {
        imageFiles.push(result.path);
        console.log('✅ 確認檔案存在:', path.basename(result.path));
      } else {
        console.warn('⚠️ 檔案不存在:', result.path);
      }
    }

    if (imageFiles.length === 0) {
      throw new Error('轉換完成但沒有生成有效的圖片檔案');
    }

    console.log('✅ 圖片轉換完成:', imageFiles.length, '張圖片');
    return imageFiles;
    
  } catch (error) {
    console.error('❌ 圖片轉換失敗:', error);
    
    // 作為備選方案，嘗試使用系統命令直接轉換
    try {
      console.log('🔄 嘗試使用系統命令轉換...');
      const fallbackResult = await convertPDFUsingSystemCommand(pdfPath, outputDir);
      return fallbackResult;
    } catch (fallbackError) {
      console.error('❌ 系統命令轉換也失敗:', fallbackError);
      throw error; // 拋出原始錯誤
    }
  }
}

/**
 * 使用系統命令直接轉換 PDF 為圖片（備選方案）
 */
async function convertPDFUsingSystemCommand(pdfPath, outputDir) {
  return new Promise((resolve, reject) => {
    const baseName = path.basename(pdfPath, '.pdf');
    const outputPattern = path.join(outputDir, `${baseName}-%d.png`);
    
    // 嘗試使用 convert 命令
    const convertCmd = `convert -density 200 -quality 85 "${pdfPath}" "${outputPattern}"`;
    
    console.log('🔧 執行系統命令:', convertCmd);
    
    exec(convertCmd, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ 系統命令執行失敗:', error);
        reject(error);
        return;
      }
      
      try {
        // 檢查生成的檔案
        const files = fs.readdirSync(outputDir);
        console.log('📁 輸出目錄中的檔案:', files);
        
        let imageFiles = files
          .filter(f => f.startsWith(baseName) && (f.endsWith('.png') || f.endsWith('.jpg')))
          .map(f => path.join(outputDir, f))
          .sort();
        
        // 如果沒有找到預期格式的檔案，嘗試其他可能的格式
        if (imageFiles.length === 0) {
          console.log('🔍 尋找其他格式的圖片檔案...');
          imageFiles = files
            .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
            .map(f => path.join(outputDir, f))
            .sort();
        }
        
        // 驗證檔案是否真實存在且大小合理
        const validImageFiles = [];
        for (const filePath of imageFiles) {
          try {
            const stats = fs.statSync(filePath);
            if (stats.size > 100) { // 至少 100 bytes
              validImageFiles.push(filePath);
              console.log('✅ 有效圖片檔案:', path.basename(filePath), `(${(stats.size/1024).toFixed(1)}KB)`);
            } else {
              console.warn('⚠️ 檔案太小，可能損壞:', path.basename(filePath));
            }
          } catch (statError) {
            console.warn('⚠️ 無法讀取檔案狀態:', path.basename(filePath));
          }
        }
        
        if (validImageFiles.length === 0) {
          reject(new Error('系統命令沒有生成任何有效的圖片檔案'));
          return;
        }
        
        console.log('✅ 系統命令轉換成功:', validImageFiles.length, '張圖片');
        resolve(validImageFiles);
        
      } catch (fsError) {
        console.error('❌ 檔案系統錯誤:', fsError);
        reject(fsError);
      }
    });
  });
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
        // 批量下載 URL (可以是 ZIP 或資料夾資訊)
        downloadUrl: imageFiles.length > 0 ? `${baseUrl}/api/download/images/${imageFolderName}` : null,
        // ZIP 下載 URL
        zipDownloadUrl: imageFiles.length > 0 ? `${baseUrl}/api/download/images/${imageFolderName}/zip` : null,
        // 個別檔案下載連結
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

// ============= N8N 通知功能（模仿 LINE 訊息格式）=============

/**
 * 生成 reply token (模擬 LINE 的 reply token 格式)
 */
function generateReplyToken() {
  // LINE reply token 格式通常是一個長的隨機字串
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * 構造 LINE 風格的訊息內容
 */
function createLineStyleMessage(originalFileName, conversionResult) {
  let messageText = `📄 檔案轉換完成！\n\n`;
  messageText += `原檔案：${originalFileName}\n`;
  messageText += `轉換時間：${new Date().toLocaleString('zh-TW')}\n\n`;
  
  // PDF 下載
  messageText += `🔗 下載連結：\n`;
  messageText += `📄 PDF 檔案：\n${conversionResult.pdfFile.downloadUrl}\n\n`;
  
  // 圖片下載
  if (conversionResult.imageFiles.count > 0) {
    messageText += `🖼️ 圖片檔案 (${conversionResult.imageFiles.count} 張)：\n`;
    messageText += `📦 批量下載(ZIP)：\n${conversionResult.imageFiles.zipDownloadUrl}\n\n`;
    
    // 列出個別圖片
    if (conversionResult.imageFiles.files && conversionResult.imageFiles.files.length > 0) {
      messageText += `📋 個別頁面：\n`;
      conversionResult.imageFiles.files.forEach((img, index) => {
        messageText += `第 ${img.page} 頁：${img.downloadUrl}\n`;
      });
    }
  } else {
    messageText += `⚠️ 圖片轉換未成功，僅提供 PDF 下載\n`;
  }
  
  return messageText;
}

/**
 * 發送 LINE 風格的訊息到 N8N
 */
async function sendLineStyleMessageToN8N(userId, fileInfo, conversionResult) {
  try {
    console.log('💬 發送 LINE 風格訊息到 N8N');
    
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('⚠️ N8N_WEBHOOK_URL 未設定，跳過發送通知');
      return false;
    }

    const replyToken = generateReplyToken();
    const messageText = createLineStyleMessage(fileInfo.fileName, conversionResult);

    // 構造模仿 LINE webhook 的資料結構
    const lineStyleData = {
      // === LINE Webhook 標準格式 ===
      destination: process.env.LINE_BOT_USER_ID || 'bot_destination',
      events: [
        {
          type: 'message',
          mode: 'active',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: userId || 'anonymous_user'
          },
          replyToken: replyToken,
          message: {
            type: 'text',
            id: `msg_${Date.now()}`,
            text: messageText
          }
        }
      ],
      
      // === 自訂的檔案處理資訊 ===
      customData: {
        type: 'file_conversion_completed',
        processingInfo: {
          originalFile: {
            name: fileInfo.fileName,
            size: fileInfo.fileSize,
            uploadTime: fileInfo.uploadTime
          },
          
          // PDF 資訊
          pdfResult: {
            fileName: conversionResult.pdfFile.name,
            downloadUrl: conversionResult.pdfFile.downloadUrl,
            fileSize: conversionResult.pdfFile.size
          },
          
          // 圖片資訊
          imageResult: {
            count: conversionResult.imageFiles.count,
            zipDownloadUrl: conversionResult.imageFiles.zipDownloadUrl,
            batchDownloadUrl: conversionResult.imageFiles.downloadUrl,
            individualFiles: conversionResult.imageFiles.files
          },
          
          processTime: conversionResult.processTime
        }
      },
      
      // === 額外的 N8N 處理提示 ===
      n8nProcessingHints: {
        shouldReplyToUser: true,
        replyToken: replyToken,
        messageType: 'file_conversion_result',
        hasMultipleDownloads: conversionResult.imageFiles.count > 0,
        recommendedAction: 'send_download_links'
      }
    };

    // 詳細日誌
    console.log('📤 LINE 風格資料結構:');
    console.log('  🎯 Reply Token:', replyToken);
    console.log('  👤 User ID:', userId || 'anonymous_user');
    console.log('  📝 訊息長度:', messageText.length, '字元');
    console.log('  📄 PDF URL:', conversionResult.pdfFile.downloadUrl);
    console.log('  🖼️ 圖片數量:', conversionResult.imageFiles.count);

    // 發送到 N8N
    const response = await axios.post(webhookUrl, lineStyleData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LINE-Bot/1.0',
        'X-Line-Signature': 'mock-line-signature', // 模擬 LINE 簽名
        'X-Source': 'line-bot-file-converter',
        'X-Custom-Type': 'file-conversion-completed'
      },
      timeout: 15000
    });

    console.log('✅ LINE 風格訊息發送成功！');
    console.log('📡 N8N 回應狀態:', response.status);
    
    if (response.data) {
      console.log('📥 N8N 回應內容:', JSON.stringify(response.data, null, 2));
    }

    return {
      success: true,
      replyToken: replyToken,
      messageLength: messageText.length,
      n8nResponse: response.status
    };

  } catch (error) {
    console.error('❌ 發送 LINE 風格訊息失敗:', error.message);
    if (error.response) {
      console.error('📡 N8N 錯誤回應:', error.response.status, error.response.data);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

// ===== API 路由 =====

// 健康檢查
app.get('/api/health', async (req, res) => {
  console.log('❤️ 健康檢查');
  
  // 檢查系統工具
  const systemTools = await checkSystemTools();
  
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
    systemTools: systemTools,
    features: {
      pdfUpload: true,
      docConversion: !!libreOfficeConvert,
      imageConversion: !!pdf2pic,
      lineStyleMessaging: true  // 新增功能
    },
    n8nWebhook: process.env.N8N_WEBHOOK_URL ? '已設定 (LINE 風格)' : '未設定'
  });
});

// 測試 API
app.get('/api/test', (req, res) => {
  console.log('🧪 測試 API');
  res.json({ 
    message: '文件轉換伺服器正常運作 (LINE 風格訊息)',
    timestamp: new Date().toISOString(),
    features: ['檔案上傳', 'PDF轉換', '圖片轉換', 'LINE風格訊息']
  });
});

// 檔案上傳與轉換 API（使用 LINE 風格訊息）
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
      
      // 發送 LINE 風格訊息到 N8N
      console.log('💬 發送 LINE 風格訊息到 N8N...');
      const n8nResult = await sendLineStyleMessageToN8N(userId, fileInfo, conversionResult);

      // 清理原始上傳檔案（可選）
      if (process.env.KEEP_ORIGINAL_FILES !== 'true') {
        try {
          fs.unlinkSync(req.file.path);
          console.log('🗑️ 已清理原始上傳檔案');
        } catch (cleanupError) {
          console.warn('⚠️ 清理原始檔案失敗:', cleanupError.message);
        }
      }

      // 回應給前端（簡化版）
      const result = {
        success: true,
        message: '檔案轉換完成，已發送 LINE 風格訊息',
        fileName: req.file.originalname,
        lineMessage: {
          sent: n8nResult.success,
          replyToken: n8nResult.replyToken,
          error: n8nResult.error
        },
        conversions: {
          pdfGenerated: true,
          imagesGenerated: conversionResult.imageFiles.count > 0
        }
      };

      console.log('🏁 LINE 風格轉換流程完成:', {
        檔案: fileInfo.fileName,
        'PDF': conversionResult.pdfFile.name,
        '圖片數': conversionResult.imageFiles.count,
        'LINE訊息': n8nResult.success ? '✅' : '❌',
        'Reply Token': n8nResult.replyToken
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

// 新增：測試 LINE 風格訊息的 API
app.post('/api/test-line-message', async (req, res) => {
  try {
    console.log('🧪 測試 LINE 風格訊息');
    
    const { userId, fileName } = req.body;
    
    // 模擬轉換結果
    const mockConversionResult = {
      pdfFile: {
        name: fileName || 'test-document.pdf',
        downloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/pdf/test-123.pdf`,
        size: 1024000
      },
      imageFiles: {
        count: 3,
        downloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/images/test-123`,
        zipDownloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/images/test-123/zip`,
        files: [
          { name: 'test-123.1.png', page: 1, downloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/images/test-123/test-123.1.png` },
          { name: 'test-123.2.png', page: 2, downloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/images/test-123/test-123.2.png` },
          { name: 'test-123.3.png', page: 3, downloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/images/test-123/test-123.3.png` }
        ]
      },
      processTime: new Date().toISOString()
    };
    
    const mockFileInfo = {
      fileName: fileName || 'test-document.pdf',
      savedName: 'test-123-test-document.pdf',
      fileSize: 1024000,
      uploadTime: new Date().toISOString()
    };
    
    // 發送測試訊息
    const n8nResult = await sendLineStyleMessageToN8N(userId, mockFileInfo, mockConversionResult);
    
    res.json({
      success: true,
      message: '測試 LINE 風格訊息已發送',
      result: n8nResult,
      testData: {
        fileInfo: mockFileInfo,
        conversionResult: mockConversionResult
      }
    });
    
  } catch (error) {
    console.error('❌ 測試 LINE 訊息失敗:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 下載路由
app.get('/api/download/pdf/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(pdfDir, filename);
  downloadFile(res, filePath, 'PDF檔案');
});

// 圖片資料夾資訊
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
      })),
      // 提供 ZIP 下載連結
      zipDownloadUrl: `/api/download/images/${folderName}/zip`
    });

  } catch (error) {
    console.error('❌ 列出圖片失敗:', error);
    res.status(500).json({ error: '無法存取圖片資料夾' });
  }
});

// ZIP 下載所有圖片
app.get('/api/download/images/:folder/zip', async (req, res) => {
  try {
    const folderName = req.params.folder;
    const folderPath = path.join(imageDir, folderName);
    
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({ error: '圖片資料夾不存在' });
    }

    // 動態載入 archiver（如果需要的話）
    let archiver;
    try {
      archiver = require('archiver');
    } catch (e) {
      // 如果沒有 archiver，提供替代方案
      return res.status(501).json({ 
        error: 'ZIP 功能不可用',
        message: '請使用個別圖片下載連結',
        alternativeEndpoint: `/api/download/images/${folderName}`
      });
    }

    const files = fs.readdirSync(folderPath);
    const imageFiles = files.filter(f => f.toLowerCase().endsWith('.png') || f.toLowerCase().endsWith('.jpg'));
    
    if (imageFiles.length === 0) {
      return res.status(404).json({ error: '資料夾中沒有圖片檔案' });
    }

    console.log('📦 建立 ZIP 檔案:', folderName, imageFiles.length, '張圖片');

    // 設定回應標頭
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${folderName}-images.zip"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // 建立 ZIP 檔案
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.on('error', (err) => {
      console.error('❌ ZIP 建立錯誤:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'ZIP 檔案建立失敗' });
      }
    });

    archive.pipe(res);

    // 添加所有圖片到 ZIP
    imageFiles.forEach((fileName, index) => {
      const filePath = path.join(folderPath, fileName);
      archive.file(filePath, { name: `page-${index + 1}-${fileName}` });
    });

    await archive.finalize();
    console.log('✅ ZIP 下載完成:', folderName);

  } catch (error) {
    console.error('❌ ZIP 下載錯誤:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'ZIP 下載失敗' });
    }
  }
});

// 單個圖片下載
app.get('/api/download/images/:folder/:filename', (req, res) => {
  const folderName = req.params.folder;
  const filename = req.params.filename;
  const filePath = path.join(imageDir, folderName, filename);
  
  console.log('🖼️ 圖片下載請求詳情:');
  console.log('  資料夾:', folderName);
  console.log('  檔案名:', filename);
  console.log('  完整路徑:', filePath);
  console.log('  檔案存在:', fs.existsSync(filePath));
  
  // 如果檔案不存在，嘗試列出資料夾內容來調試
  if (!fs.existsSync(filePath)) {
    const folderPath = path.join(imageDir, folderName);
    console.log('❌ 檔案不存在，檢查資料夾內容:');
    console.log('  資料夾路徑:', folderPath);
    console.log('  資料夾存在:', fs.existsSync(folderPath));
    
    if (fs.existsSync(folderPath)) {
      try {
        const files = fs.readdirSync(folderPath);
        console.log('  資料夾內容:', files);
        
        // 尋找相似的檔案名
        const similarFiles = files.filter(f => 
          f.includes(path.parse(filename).name.split('-')[0]) || 
          f.includes(path.parse(filename).name)
        );
        console.log('  相似檔案:', similarFiles);
        
        // 如果找到完全匹配的檔案，重新導向
        if (files.includes(filename)) {
          console.log('✅ 找到檔案，重新嘗試下載');
          return downloadFile(res, filePath, '圖片檔案');
        }
        
        // 如果找到相似檔案，建議正確的檔名
        if (similarFiles.length > 0) {
          console.log('💡 建議使用:', similarFiles[0]);
          return res.status(404).json({ 
            error: '檔案不存在',
            suggestion: similarFiles[0],
            correctUrl: `/api/download/images/${folderName}/${similarFiles[0]}`,
            availableFiles: files
          });
        }
        
      } catch (readError) {
        console.error('❌ 讀取資料夾失敗:', readError);
      }
    }
    
    return res.status(404).json({ 
      error: '圖片檔案不存在',
      folderName: folderName,
      fileName: filename,
      fullPath: filePath
    });
  }
  
  downloadFile(res, filePath, '圖片檔案');
});

// 新增：調試用的資料夾檢查 API
app.get('/api/debug/images/:folder', (req, res) => {
  try {
    const folderName = req.params.folder;
    const folderPath = path.join(imageDir, folderName);
    
    console.log('🔍 調試資料夾:', folderPath);
    
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({
        error: '資料夾不存在',
        folderPath: folderPath,
        imageDir: imageDir
      });
    }
    
    const files = fs.readdirSync(folderPath);
    const fileDetails = files.map(fileName => {
      const filePath = path.join(folderPath, fileName);
      const stats = fs.statSync(filePath);
      return {
        name: fileName,
        size: stats.size,
        isFile: stats.isFile(),
        extension: path.extname(fileName),
        downloadUrl: `/api/download/images/${folderName}/${fileName}`
      };
    });
    
    res.json({
      folderName: folderName,
      folderPath: folderPath,
      totalFiles: files.length,
      files: fileDetails,
      imageFiles: fileDetails.filter(f => 
        f.extension.toLowerCase() === '.png' || 
        f.extension.toLowerCase() === '.jpg'
      )
    });
    
  } catch (error) {
    console.error('❌ 調試 API 錯誤:', error);
    res.status(500).json({ error: error.message });
  }
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

// 伺服器初始化
const initializeServer = async () => {
  // 載入轉換模組
  await loadConversionModules();
  
  // 啟動伺服器
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('🎉 文件轉換伺服器啟動成功！(LINE 風格訊息版本)');
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`📁 資料夾:`);
    console.log(`   📤 上傳: ${uploadDir}`);
    console.log(`   📄 PDF: ${pdfDir}`);
    console.log(`   🖼️ 圖片: ${imageDir}`);
    console.log(`🔧 轉換功能:`);
    console.log(`   📄 DOC/DOCX → PDF: ${libreOfficeConvert ? '✅' : '❌ (只支援 PDF 上傳)'}`);
    console.log(`   🖼️ PDF → 圖片: ${pdf2pic ? '✅' : '❌ (只支援 PDF 下載)'}`);
    console.log(`💬 LINE 風格訊息: ✅`);
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
    
    console.log('✨ 新版系統流程 (LINE 風格)：');
    console.log('   📤 檔案上傳');
    console.log('   📄 轉換為 PDF (如果需要)');
    console.log('   🖼️ 轉換為圖片 (如果可用)');
    console.log('   💬 生成 LINE 風格訊息');
    console.log('   🎯 發送含 Reply Token 的訊息到 N8N');
    console.log('   ✅ 回傳簡單確認給前端');
    console.log('================================');
    console.log('🧪 測試端點：');
    console.log('   POST /api/test-line-message - 測試 LINE 風格訊息');
    console.log('   GET /api/health - 系統健康檢查');
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
};

// 啟動應用程式
initializeServer().catch(error => {
  console.error('❌ 伺服器初始化失敗:', error);
  process.exit(1);
});
