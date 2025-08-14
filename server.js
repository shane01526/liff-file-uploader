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
  const systemTools = await checkSystemTools();
  
  try {
    libreOfficeConvert = require('libreoffice-convert');
    libreOfficeConvert.convertAsync = promisify(libreOfficeConvert.convert);
    console.log('✅ LibreOffice 轉換模組載入成功');
  } catch (error) {
    console.warn('⚠️ LibreOffice 轉換模組載入失敗:', error.message);
  }

  try {
    if (systemTools.gm === '❌ 不可用' && systemTools.convert === '❌ 不可用') {
      throw new Error('GraphicsMagick 和 ImageMagick 都不可用');
    }
    
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

console.log('🚀 啟動增強版伺服器 (含使用者資訊)...');
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

    const inputBuffer = fs.readFileSync(inputPath);
    const pdfBuffer = await libreOfficeConvert.convertAsync(inputBuffer, '.pdf', undefined);
    fs.writeFileSync(outputPath, pdfBuffer);
    
    console.log('✅ PDF 轉換完成:', path.basename(outputPath));
    return outputPath;
    
  } catch (error) {
    console.error('❌ PDF 轉換失敗:', error);
    throw error;
  }
}

/**
 * PDF 轉換為圖片
 */
async function convertPDFToImages(pdfPath, outputDir) {
  try {
    console.log('🖼️ 開始將 PDF 轉換為圖片:', path.basename(pdfPath));
    
    if (!pdf2pic) {
      throw new Error('PDF2Pic 轉換模組未載入，無法轉換 PDF 為圖片');
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const baseName = path.basename(pdfPath, '.pdf');
    
    const configs = [
      {
        density: parseInt(process.env.PDF_CONVERT_DENSITY) || 200,
        saveFilename: `${baseName}.%d`,
        savePath: outputDir,
        format: process.env.IMAGE_OUTPUT_FORMAT || "png",
        width: parseInt(process.env.IMAGE_OUTPUT_WIDTH) || 1200,
        height: parseInt(process.env.IMAGE_OUTPUT_HEIGHT) || 1600,
        convert: "convert"
      },
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
          break;
        }
      } catch (error) {
        console.warn(`⚠️ 配置 ${i + 1} 轉換失敗:`, error.message);
        lastError = error;
        continue;
      }
    }

    if (!results || results.length === 0) {
      try {
        console.log('🔄 嘗試使用系統命令轉換...');
        return await convertPDFUsingSystemCommand(pdfPath, outputDir);
      } catch (fallbackError) {
        throw lastError || fallbackError;
      }
    }

    const imageFiles = [];
    for (const result of results) {
      if (fs.existsSync(result.path)) {
        imageFiles.push(result.path);
        console.log('✅ 確認檔案存在:', path.basename(result.path));
      }
    }

    if (imageFiles.length === 0) {
      throw new Error('轉換完成但沒有生成有效的圖片檔案');
    }

    console.log('✅ 圖片轉換完成:', imageFiles.length, '張圖片');
    return imageFiles;
    
  } catch (error) {
    console.error('❌ 圖片轉換失敗:', error);
    throw error;
  }
}

/**
 * 使用系統命令轉換 PDF 為圖片
 */
async function convertPDFUsingSystemCommand(pdfPath, outputDir) {
  return new Promise((resolve, reject) => {
    const baseName = path.basename(pdfPath, '.pdf');
    const outputPattern = path.join(outputDir, `${baseName}-%d.png`);
    const convertCmd = `convert -density 200 -quality 85 "${pdfPath}" "${outputPattern}"`;
    
    console.log('🔧 執行系統命令:', convertCmd);
    
    exec(convertCmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      
      try {
        const files = fs.readdirSync(outputDir);
        let imageFiles = files
          .filter(f => f.startsWith(baseName) && (f.endsWith('.png') || f.endsWith('.jpg')))
          .map(f => path.join(outputDir, f))
          .sort();
        
        if (imageFiles.length === 0) {
          imageFiles = files
            .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
            .map(f => path.join(outputDir, f))
            .sort();
        }
        
        const validImageFiles = [];
        for (const filePath of imageFiles) {
          try {
            const stats = fs.statSync(filePath);
            if (stats.size > 100) {
              validImageFiles.push(filePath);
              console.log('✅ 有效圖片檔案:', path.basename(filePath), `(${(stats.size/1024).toFixed(1)}KB)`);
            }
          } catch (statError) {
            console.warn('⚠️ 無法讀取檔案狀態:', path.basename(filePath));
          }
        }
        
        if (validImageFiles.length === 0) {
          reject(new Error('系統命令沒有生成任何有效的圖片檔案'));
          return;
        }
        
        resolve(validImageFiles);
        
      } catch (fsError) {
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
    
    let pdfPath = path.join(pdfDir, `${timestamp}-${originalName}.pdf`);
    
    if (originalExt === '.pdf') {
      fs.copyFileSync(originalFile.path, pdfPath);
      console.log('📄 檔案已是 PDF 格式，複製到 PDF 目錄');
    } else {
      if (!libreOfficeConvert) {
        throw new Error('系統不支援 DOC/DOCX 轉換功能，請直接上傳 PDF 檔案');
      }
      await convertToPDF(originalFile.path, pdfPath);
    }

    const imageOutputDir = path.join(imageDir, `${timestamp}-${originalName}`);
    let imageFiles = [];
    
    if (pdf2pic) {
      try {
        imageFiles = await convertPDFToImages(pdfPath, imageOutputDir);
      } catch (imageError) {
        console.warn('⚠️ 圖片轉換失敗，但 PDF 轉換成功:', imageError.message);
      }
    }

    const baseUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
    const pdfFileName = path.basename(pdfPath);
    const imageFolderName = path.basename(imageOutputDir);
    
    const result = {
      pdfFile: {
        name: `${originalName}.pdf`,
        downloadUrl: `${baseUrl}/api/download/pdf/${pdfFileName}`,
        size: fs.statSync(pdfPath).size
      },
      imageFiles: {
        count: imageFiles.length,
        downloadUrl: imageFiles.length > 0 ? `${baseUrl}/api/download/images/${imageFolderName}` : null,
        zipDownloadUrl: imageFiles.length > 0 ? `${baseUrl}/api/download/images/${imageFolderName}/zip` : null,
        files: imageFiles.map((filePath, index) => ({
          name: path.basename(filePath),
          page: index + 1,
          downloadUrl: `${baseUrl}/api/download/images/${imageFolderName}/${path.basename(filePath)}`
        }))
      },
      processTime: new Date().toISOString()
    };

    return result;

  } catch (error) {
    console.error('❌ 檔案轉換流程失敗:', error);
    throw error;
  }
}

// ============= 增強版 N8N 通知功能 =============

/**
 * 生成 reply token
 */
function generateReplyToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * 構造包含下載連結的 LINE 風格訊息
 */
function createEnhancedLineMessage(userInfo, originalFileName, conversionResult) {
  let messageText = `📄 ${userInfo.name} 您好！檔案轉換完成！\n\n`;
  messageText += `原檔案：${originalFileName}\n`;
  messageText += `轉換時間：${new Date().toLocaleString('zh-TW')}\n\n`;
  
  // PDF 下載
  messageText += `🔗 下載連結：\n`;
  messageText += `📄 PDF 檔案：\n${conversionResult.pdfFile.downloadUrl}\n\n`;
  
  // 圖片下載
  if (conversionResult.imageFiles.count > 0) {
    messageText += `🖼️ 圖片檔案 (${conversionResult.imageFiles.count} 張)：\n`;
    messageText += `📦 批量下載(ZIP)：\n${conversionResult.imageFiles.zipDownloadUrl}\n\n`;
    
    if (conversionResult.imageFiles.files && conversionResult.imageFiles.files.length > 0) {
      messageText += `📋 個別頁面：\n`;
      conversionResult.imageFiles.files.forEach((img) => {
        messageText += `第 ${img.page} 頁：${img.downloadUrl}\n`;
      });
    }
  } else {
    messageText += `⚠️ 圖片轉換未成功，僅提供 PDF 下載\n`;
  }
  
  return messageText;
}

/**
 * 發送增強版 LINE 風格訊息到 N8N (含完整使用者資訊和下載連結)
 */
async function sendEnhancedMessageToN8N(userInfo, fileInfo, conversionResult) {
  try {
    console.log('💬 發送增強版 LINE 風格訊息到 N8N');
    
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('⚠️ N8N_WEBHOOK_URL 未設定，跳過發送通知');
      return false;
    }

    const replyToken = generateReplyToken();
    const messageText = createEnhancedLineMessage(userInfo, fileInfo.fileName, conversionResult);

    // 增強版資料結構，包含完整使用者資訊和所有下載連結
    const enhancedLineData = {
      // === LINE Webhook 標準格式 ===
      destination: process.env.LINE_BOT_USER_ID || 'bot_destination',
      events: [
        {
          type: 'message',
          mode: 'active',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: userInfo.liffUserId || 'anonymous_user'
          },
          replyToken: replyToken,
          message: {
            type: 'text',
            id: `msg_${Date.now()}`,
            text: messageText
          }
        }
      ],
      
      // === 完整的使用者資訊 ===
      userInfo: {
        name: userInfo.name,
        email: userInfo.email || null,
        phone: userInfo.phone || null,
        liffUserId: userInfo.liffUserId || null,
        submissionTime: new Date().toISOString()
      },
      
      // === 檔案處理資訊 ===
      fileProcessing: {
        originalFile: {
          name: fileInfo.fileName,
          size: fileInfo.fileSize,
          uploadTime: fileInfo.uploadTime
        },
        
        // PDF 結果 (包含完整下載連結)
        pdfResult: {
          fileName: conversionResult.pdfFile.name,
          downloadUrl: conversionResult.pdfFile.downloadUrl,
          fileSize: conversionResult.pdfFile.size,
          // 直接提供可點擊的連結
          directDownloadLink: conversionResult.pdfFile.downloadUrl
        },
        
        // 圖片結果 (包含所有下載選項)
        imageResult: {
          count: conversionResult.imageFiles.count,
          hasImages: conversionResult.imageFiles.count > 0,
          
          // 批量下載選項
          batchDownload: {
            zipUrl: conversionResult.imageFiles.zipDownloadUrl,
            folderUrl: conversionResult.imageFiles.downloadUrl
          },
          
          // 個別檔案下載連結
          individualFiles: conversionResult.imageFiles.files.map(file => ({
            page: file.page,
            fileName: file.name,
            downloadUrl: file.downloadUrl,
            // 直接可用的連結
            directLink: file.downloadUrl
          }))
        },
        
        processTime: conversionResult.processTime
      },
      
      // === 所有下載連結的匯總 (方便 N8N 直接取用) ===
      downloadLinks: {
        // PDF 下載
        pdf: {
          url: conversionResult.pdfFile.downloadUrl,
          fileName: conversionResult.pdfFile.name,
          type: 'pdf'
        },
        
        // 圖片下載 (如果有的話)
        images: conversionResult.imageFiles.count > 0 ? {
          // ZIP 批量下載
          zipDownload: {
            url: conversionResult.imageFiles.zipDownloadUrl,
            fileName: `${path.parse(fileInfo.fileName).name}-images.zip`,
            type: 'zip',
            description: `包含 ${conversionResult.imageFiles.count} 張圖片`
          },
          
          // 個別圖片下載
          individual: conversionResult.imageFiles.files.map(file => ({
            url: file.downloadUrl,
            fileName: file.name,
            page: file.page,
            type: 'image'
          }))
        } : null
      },
      
      // === N8N 處理提示 ===
      n8nProcessingHints: {
        shouldReplyToUser: true,
        replyToken: replyToken,
        messageType: 'file_conversion_completed',
        userName: userInfo.name,
        hasMultipleDownloads: conversionResult.imageFiles.count > 0,
        recommendedAction: 'send_download_links_with_user_greeting',
        
        // 建議的回覆格式
        suggestedReplyFormat: {
          greeting: `${userInfo.name} 您好！`,
          pdfLink: `📄 PDF: ${conversionResult.pdfFile.downloadUrl}`,
          imageLinks: conversionResult.imageFiles.count > 0 ? 
            `🖼️ 圖片 (${conversionResult.imageFiles.count}張): ${conversionResult.imageFiles.zipDownloadUrl}` : null
        }
      }
    };

    console.log('📤 增強版資料結構:');
    console.log('  👤 使用者:', userInfo.name);
    console.log('  📧 Email:', userInfo.email || '未提供');
    console.log('  📱 電話:', userInfo.phone || '未提供');
    console.log('  🎯 Reply Token:', replyToken);
    console.log('  📄 PDF 連結:', conversionResult.pdfFile.downloadUrl);
    console.log('  🖼️ 圖片數量:', conversionResult.imageFiles.count);
    if (conversionResult.imageFiles.count > 0) {
      console.log('  📦 ZIP 連結:', conversionResult.imageFiles.zipDownloadUrl);
    }

    // 發送到 N8N (修復標頭中文字元問題)
    const response = await axios.post(webhookUrl, enhancedLineData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LINE-Bot/1.0',
        'X-Line-Signature': 'mock-line-signature',
        'X-Source': 'line-bot-file-converter-enhanced',
        'X-Custom-Type': 'file-conversion-with-user-info',
        'X-User-Name': encodeURIComponent(userInfo.name), // 編碼中文字元
        'X-Has-Images': conversionResult.imageFiles.count > 0 ? 'true' : 'false',
        'X-File-Count': conversionResult.imageFiles.count.toString()
      },
      timeout: 15000
    });

    console.log('✅ 增強版訊息發送成功！');
    console.log('📡 N8N 回應狀態:', response.status);
    
    if (response.data) {
      console.log('📥 N8N 回應內容:', JSON.stringify(response.data, null, 2));
    }

    return {
      success: true,
      replyToken: replyToken,
      messageLength: messageText.length,
      n8nResponse: response.status,
      userInfo: userInfo,
      downloadLinks: enhancedLineData.downloadLinks
    };

  } catch (error) {
    console.error('❌ 發送增強版訊息失敗:', error.message);
    if (error.response) {
      console.error('📡 N8N 錯誤回應:', error.response.status, error.response.data);
    }
    return {
      success: false,
      error: error.message,
      userInfo: userInfo
    };
  }
}

// ===== API 路由 =====

// 健康檢查
app.get('/api/health', async (req, res) => {
  console.log('❤️ 健康檢查');
  
  const systemTools = await checkSystemTools();
  
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    port: PORT,
    version: 'enhanced-with-user-info',
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
      userInfoCollection: true,  // 新功能
      enhancedLineMessaging: true,  // 增強功能
      completeDownloadLinks: true   // 完整下載連結
    },
    n8nWebhook: process.env.N8N_WEBHOOK_URL ? '已設定 (增強版)' : '未設定'
  });
});

// 測試 API
app.get('/api/test', (req, res) => {
  console.log('🧪 測試 API');
  res.json({ 
    message: '增強版文件轉換伺服器正常運作',
    timestamp: new Date().toISOString(),
    features: [
      '檔案上傳', 
      'PDF轉換', 
      '圖片轉換', 
      '使用者資訊收集', 
      '增強版LINE風格訊息',
      '完整下載連結提供'
    ],
    version: 'enhanced-v2'
  });
});

// 增強版檔案上傳與轉換 API
app.post('/api/upload', (req, res) => {
  console.log('📤 收到增強版上傳請求');
  
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

      // 提取使用者資訊
      const userInfo = {
        name: req.body.userName?.trim(),
        email: req.body.userEmail?.trim() || null,
        phone: req.body.userPhone?.trim() || null,
        liffUserId: req.body.userId || null
      };

      // 驗證使用者姓名
      if (!userInfo.name || userInfo.name.length < 2) {
        return res.status(400).json({
          success: false,
          error: '請提供有效的使用者姓名'
        });
      }

      console.log('👤 使用者資訊:', userInfo);

      const originalExt = path.extname(req.file.originalname).toLowerCase();
      
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
        檔案大小: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
        上傳者: userInfo.name
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

      // 發送增強版 LINE 風格訊息到 N8N
      console.log('💬 發送增強版訊息到 N8N...');
      const n8nResult = await sendEnhancedMessageToN8N(userInfo, fileInfo, conversionResult);

      // 清理原始上傳檔案
      if (process.env.KEEP_ORIGINAL_FILES !== 'true') {
        try {
          fs.unlinkSync(req.file.path);
          console.log('🗑️ 已清理原始上傳檔案');
        } catch (cleanupError) {
          console.warn('⚠️ 清理原始檔案失敗:', cleanupError.message);
        }
      }

      // 回應給前端
      const result = {
        success: true,
        message: `${userInfo.name} 您好！檔案轉換完成`,
        fileName: req.file.originalname,
        userInfo: {
          name: userInfo.name,
          email: userInfo.email,
          phone: userInfo.phone
        },
        n8nNotified: n8nResult.success,
        lineMessage: {
          sent: n8nResult.success,
          replyToken: n8nResult.replyToken,
          error: n8nResult.error
        },
        conversions: {
          pdfGenerated: true,
          imagesGenerated: conversionResult.imageFiles.count > 0,
          pdfUrl: conversionResult.pdfFile.downloadUrl,
          imageZipUrl: conversionResult.imageFiles.zipDownloadUrl
        },
        downloadLinks: n8nResult.downloadLinks || null
      };

      console.log('🏁 增強版轉換流程完成:', {
        使用者: userInfo.name,
        檔案: fileInfo.fileName,
        'PDF': conversionResult.pdfFile.name,
        '圖片數': conversionResult.imageFiles.count,
        'N8N通知': n8nResult.success ? '✅' : '❌',
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

// 測試 N8N Webhook 連接
app.get('/api/test-n8n-connection', async (req, res) => {
  try {
    console.log('🔍 測試 N8N Webhook 連接');
    
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      return res.json({
        success: false,
        error: 'N8N_WEBHOOK_URL 環境變數未設定',
        message: '請在 .env 檔案中設定 N8N_WEBHOOK_URL'
      });
    }

    console.log('🎯 測試 URL:', webhookUrl);

    // 發送簡單的測試資料
    const testData = {
      type: 'connection_test',
      timestamp: new Date().toISOString(),
      message: 'N8N Webhook 連接測試',
      source: 'liff-file-uploader'
    };

    const response = await axios.post(webhookUrl, testData, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'N8N-Test/1.0',
        'X-Test': 'true'
      },
      timeout: 10000
    });

    console.log('✅ N8N 連接測試成功');
    console.log('📡 回應狀態:', response.status);
    console.log('📄 回應內容:', response.data);

    res.json({
      success: true,
      message: 'N8N Webhook 連接正常',
      webhookUrl: webhookUrl,
      responseStatus: response.status,
      responseData: response.data
    });

  } catch (error) {
    console.error('❌ N8N 連接測試失敗:', error.message);
    
    let errorDetail = error.message;
    if (error.code) {
      errorDetail += ` (${error.code})`;
    }
    if (error.response) {
      errorDetail += ` - HTTP ${error.response.status}: ${error.response.statusText}`;
    }

    res.json({
      success: false,
      error: 'N8N Webhook 連接失敗',
      detail: errorDetail,
      webhookUrl: process.env.N8N_WEBHOOK_URL,
      suggestions: [
        '檢查 N8N_WEBHOOK_URL 是否正確',
        '確認 N8N 服務是否運行',
        '檢查網路連接',
        '確認 Webhook 端點是否啟用'
      ]
    });
  }
});
app.post('/api/test-enhanced-message', async (req, res) => {
  try {
    console.log('🧪 測試增強版 LINE 風格訊息');
    
    const { 
      userName = '測試用戶', 
      userEmail = 'test@example.com',
      userPhone = '0912-345-678',
      userId = 'test-user-id',
      fileName = 'test-resume.pdf' 
    } = req.body;
    
    // 模擬使用者資訊
    const mockUserInfo = {
      name: userName,
      email: userEmail,
      phone: userPhone,
      liffUserId: userId
    };
    
    // 模擬轉換結果
    const mockConversionResult = {
      pdfFile: {
        name: fileName,
        downloadUrl: `${process.env.FRONTEND_URL || `http://localhost:${PORT}`}/api/download/pdf/test-123-${fileName}`,
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
      fileName: fileName,
      savedName: `test-123-${fileName}`,
      fileSize: 1024000,
      uploadTime: new Date().toISOString()
    };
    
    // 發送測試訊息
    const n8nResult = await sendEnhancedMessageToN8N(mockUserInfo, mockFileInfo, mockConversionResult);
    
    res.json({
      success: true,
      message: '增強版測試訊息已發送',
      result: n8nResult,
      testData: {
        userInfo: mockUserInfo,
        fileInfo: mockFileInfo,
        conversionResult: mockConversionResult
      }
    });
    
  } catch (error) {
    console.error('❌ 測試增強版訊息失敗:', error);
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

    let archiver;
    try {
      archiver = require('archiver');
    } catch (e) {
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

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${folderName}-images.zip"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    const archive = archiver('zip', { zlib: { level: 9 } });
    
    archive.on('error', (err) => {
      console.error('❌ ZIP 建立錯誤:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'ZIP 檔案建立失敗' });
      }
    });

    archive.pipe(res);

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
  
  console.log('🖼️ 圖片下載請求:', folderName, '/', filename);
  
  if (!fs.existsSync(filePath)) {
    const folderPath = path.join(imageDir, folderName);
    console.log('❌ 檔案不存在，檢查資料夾內容:');
    
    if (fs.existsSync(folderPath)) {
      try {
        const files = fs.readdirSync(folderPath);
        console.log('  資料夾內容:', files);
        
        const similarFiles = files.filter(f => 
          f.includes(path.parse(filename).name.split('-')[0]) || 
          f.includes(path.parse(filename).name)
        );
        
        if (files.includes(filename)) {
          return downloadFile(res, filePath, '圖片檔案');
        }
        
        if (similarFiles.length > 0) {
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
      fileName: filename
    });
  }
  
  downloadFile(res, filePath, '圖片檔案');
});

// 調試用的資料夾檢查 API
app.get('/api/debug/images/:folder', (req, res) => {
  try {
    const folderName = req.params.folder;
    const folderPath = path.join(imageDir, folderName);
    
    if (!fs.existsSync(folderPath)) {
      return res.status(404).json({
        error: '資料夾不存在',
        folderPath: folderPath
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
  await loadConversionModules();
  
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('🎉 增強版文件轉換伺服器啟動成功！');
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`📁 資料夾:`);
    console.log(`   📤 上傳: ${uploadDir}`);
    console.log(`   📄 PDF: ${pdfDir}`);
    console.log(`   🖼️ 圖片: ${imageDir}`);
    console.log(`🔧 轉換功能:`);
    console.log(`   📄 DOC/DOCX → PDF: ${libreOfficeConvert ? '✅' : '❌'}`);
    console.log(`   🖼️ PDF → 圖片: ${pdf2pic ? '✅' : '❌'}`);
    console.log(`👤 使用者資訊收集: ✅`);
    console.log(`💬 增強版 LINE 風格訊息: ✅`);
    console.log(`🔗 完整下載連結提供: ✅`);
    console.log(`🎯 N8N Webhook: ${process.env.N8N_WEBHOOK_URL || '未設定'}`);
    console.log('================================');
    
    console.log('✨ 增強版系統流程：');
    console.log('   👤 收集使用者資訊 (姓名*、Email、電話)');
    console.log('   📤 檔案上傳');
    console.log('   📄 轉換為 PDF (如果需要)');
    console.log('   🖼️ 轉換為圖片 (如果可用)');
    console.log('   💬 生成個人化 LINE 風格訊息');
    console.log('   🔗 包含所有下載連結');
    console.log('   🎯 發送完整資料到 N8N');
    console.log('   ✅ 回傳確認給前端');
    console.log('================================');
    console.log('🧪 測試端點：');
    console.log('   POST /api/test-enhanced-message - 測試增強版訊息');
    console.log('   GET /api/health - 系統健康檢查');
    console.log('================================');
  });

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
