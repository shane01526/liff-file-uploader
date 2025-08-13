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

// 用於存儲等待處理的文件轉換任務
const pendingTasks = new Map();

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

// LINE Webhook 簽名驗證（可選）
const crypto = require('crypto');

function verifyLineSignature(req, res, next) {
  const signature = req.headers['x-line-signature'];
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  
  if (!signature || !channelSecret) {
    console.log('⚠️ 跳過LINE簽名驗證（測試模式）');
    return next();
  }
  
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac('sha256', channelSecret).update(body).digest('base64');
  
  if (signature === hash) {
    console.log('✅ LINE簽名驗證通過');
    next();
  } else {
    console.log('❌ LINE簽名驗證失敗');
    res.status(401).json({ error: 'Invalid signature' });
  }
}

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
        density: 150,
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
      throw lastError || new Error('所有轉換配置都失敗了');
    }

    const imageFiles = [];
    for (const result of results) {
      if (fs.existsSync(result.path)) {
        imageFiles.push(result.path);
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
      console.log('📄 檔案已是 PDF 格式');
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
 * 構造文件轉換通知訊息
 */
function createFileConversionNotification(userId, originalFileName, conversionResult) {
  const downloadLinks = {
    pdf: {
      name: conversionResult.pdfFile.name,
      url: conversionResult.pdfFile.downloadUrl,
      size: conversionResult.pdfFile.size
    },
    images: {
      count: conversionResult.imageFiles.count,
      zipUrl: conversionResult.imageFiles.zipDownloadUrl,
      individualFiles: conversionResult.imageFiles.files
    }
  };

  return {
    type: 'file_conversion_completed',
    userId: userId,
    timestamp: Date.now(),
    originalFileName: originalFileName,
    conversionResult: conversionResult,
    downloadLinks: downloadLinks,
    // 新增：用於生成用戶友好的消息文本
    messageText: createUserFriendlyMessage(originalFileName, downloadLinks)
  };
}

/**
 * 創建用戶友好的消息文本
 */
function createUserFriendlyMessage(originalFileName, downloadLinks) {
  let message = `📄 檔案轉換完成！\n\n`;
  message += `原檔案：${originalFileName}\n`;
  message += `轉換時間：${new Date().toLocaleString('zh-TW')}\n\n`;
  
  message += `🔗 下載連結：\n`;
  message += `📄 PDF 檔案：\n${downloadLinks.pdf.url}\n\n`;
  
  if (downloadLinks.images.count > 0) {
    message += `🖼️ 圖片檔案 (${downloadLinks.images.count} 張)：\n`;
    message += `📦 批量下載(ZIP)：\n${downloadLinks.images.zipUrl}\n\n`;
    
    if (downloadLinks.images.individualFiles && downloadLinks.images.individualFiles.length > 0) {
      message += `📋 個別頁面：\n`;
      downloadLinks.images.individualFiles.forEach((img) => {
        message += `第 ${img.page} 頁：${img.downloadUrl}\n`;
      });
    }
  } else {
    message += `⚠️ 圖片轉換未成功，僅提供 PDF 下載\n`;
  }
  
  return message;
}

/**
 * 發送通知到 N8N
 */
async function sendNotificationToN8N(notificationData) {
  try {
    console.log('💬 發送文件轉換通知到 N8N');
    
    const webhookUrl = process.env.N8N_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('⚠️ N8N_WEBHOOK_URL 未設定，跳過發送通知');
      return { success: false, error: 'N8N Webhook URL 未設定' };
    }

    console.log('📤 發送通知資料:');
    console.log('  👤 用戶 ID:', notificationData.userId);
    console.log('  📄 原檔名:', notificationData.originalFileName);
    console.log('  📝 訊息長度:', notificationData.messageText.length, '字元');
    console.log('  📄 PDF URL:', notificationData.downloadLinks.pdf.url);
    console.log('  🖼️ 圖片數量:', notificationData.downloadLinks.images.count);

    const response = await axios.post(webhookUrl, notificationData, {
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'file-converter',
        'X-Event-Type': 'file-conversion-completed'
      },
      timeout: 15000
    });

    console.log('✅ 通知發送成功！');
    console.log('📡 N8N 回應狀態:', response.status);
    
    if (response.data) {
      console.log('📥 N8N 回應內容:', JSON.stringify(response.data, null, 2));
    }

    return {
      success: true,
      status: response.status,
      data: response.data
    };

  } catch (error) {
    console.error('❌ 發送通知失敗:', error.message);
    if (error.response) {
      console.error('📡 N8N 錯誤回應:', error.response.status, error.response.data);
    }
    return {
      success: false,
      error: error.message,
      status: error.response?.status
    };
  }
}

// ============= LINE Webhook 處理 =============

/**
 * 處理 LINE Webhook 事件
 */
app.post('/webhook/line', verifyLineSignature, async (req, res) => {
  try {
    console.log('📨 收到 LINE Webhook 事件');
    
    const events = req.body.events || [];
    
    for (const event of events) {
      console.log('🎯 處理事件:', event.type);
      
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const messageText = event.message.text.trim();
        const replyToken = event.replyToken;
        
        console.log('👤 用戶:', userId);
        console.log('💬 訊息:', messageText);
        console.log('🎫 Reply Token:', replyToken);
        
        // 檢查是否是文件轉換請求
        if (messageText === '轉換文件' || messageText.includes('上傳') || messageText.includes('履歷')) {
          // 存儲用戶的 reply token 供後續使用
          pendingTasks.set(userId, {
            replyToken: replyToken,
            timestamp: Date.now(),
            requestType: 'file_conversion'
          });
          
          console.log('💾 儲存用戶 Reply Token 供後續使用');
          
          // 回復用戶前往上傳頁面的訊息
          await replyToLineUser(replyToken, '請前往上傳頁面上傳您的文件：\n' + 
            (process.env.FRONTEND_URL || `http://localhost:${PORT}`));
        }
        
        // 檢查是否有等待處理的轉換結果
        else if (messageText === '查看結果' || messageText === '下載') {
          const pendingTask = pendingTasks.get(userId);
          if (pendingTask && pendingTask.conversionResult) {
            console.log('📋 發送轉換結果給用戶');
            await replyToLineUser(replyToken, pendingTask.messageText);
            
            // 清除已處理的任務
            pendingTasks.delete(userId);
          } else {
            await replyToLineUser(replyToken, '目前沒有待處理的轉換結果，請先上傳文件。');
          }
        }
        
        // 其他訊息的處理
        else {
          await replyToLineUser(replyToken, 
            '您好！我可以幫您轉換文件。\n請輸入「轉換文件」來開始，或直接前往：\n' + 
            (process.env.FRONTEND_URL || `http://localhost:${PORT}`)
          );
        }
      }
    }
    
    res.status(200).json({ status: 'ok' });
    
  } catch (error) {
    console.error('❌ LINE Webhook 處理錯誤:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * 回復 LINE 用戶
 */
async function replyToLineUser(replyToken, messageText) {
  try {
    const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!accessToken) {
      console.warn('⚠️ LINE_CHANNEL_ACCESS_TOKEN 未設定，無法回復用戶');
      return false;
    }

    const replyData = {
      replyToken: replyToken,
      messages: [{
        type: 'text',
        text: messageText
      }]
    };

    const response = await axios.post('https://api.line.me/v2/bot/message/reply', replyData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      }
    });

    console.log('✅ LINE 回復發送成功');
    return true;

  } catch (error) {
    console.error('❌ LINE 回復失敗:', error.message);
    return false;
  }
}

// ============= API 路由 =============

// 健康檢查
app.get('/api/health', async (req, res) => {
  console.log('❤️ 健康檢查');
  
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
      lineWebhook: true,
      n8nNotification: true
    },
    pendingTasks: pendingTasks.size,
    n8nWebhook: process.env.N8N_WEBHOOK_URL ? '已設定' : '未設定'
  });
});

// 檔案上傳與轉換 API
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
      const conversionResult = await processFileConversion(req.file);
      const userId = req.body.userId;

      // 創建通知資料
      const notificationData = createFileConversionNotification(
        userId, 
        req.file.originalname, 
        conversionResult
      );

      // 如果用戶有待處理的任務，更新轉換結果
      if (userId && pendingTasks.has(userId)) {
        const pendingTask = pendingTasks.get(userId);
        pendingTask.conversionResult = conversionResult;
        pendingTask.messageText = notificationData.messageText;
        pendingTasks.set(userId, pendingTask);
        
        console.log('💾 更新用戶待處理任務的轉換結果');
        
        // 如果有 reply token，立即回復用戶
        if (pendingTask.replyToken) {
          console.log('🚀 立即使用真實 Reply Token 回復用戶');
          await replyToLineUser(pendingTask.replyToken, notificationData.messageText);
          // 清除已使用的任務
          pendingTasks.delete(userId);
        }
      }

      // 發送通知到 N8N
      const n8nResult = await sendNotificationToN8N(notificationData);
    
    res.json({
      success: true,
      message: '測試通知已發送',
      result: n8nResult,
      testData: notificationData
    });
    
  } catch (error) {
    console.error('❌ 測試通知失敗:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 查詢待處理任務 API
app.get('/api/pending-tasks', (req, res) => {
  const tasks = Array.from(pendingTasks.entries()).map(([userId, task]) => ({
    userId: userId,
    timestamp: task.timestamp,
    requestType: task.requestType,
    hasReplyToken: !!task.replyToken,
    hasConversionResult: !!task.conversionResult
  }));
  
  res.json({
    totalTasks: pendingTasks.size,
    tasks: tasks
  });
});

// 手動觸發回復用戶 API（用於測試）
app.post('/api/manual-reply/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const { message } = req.body;
    
    const pendingTask = pendingTasks.get(userId);
    if (!pendingTask || !pendingTask.replyToken) {
      return res.status(404).json({
        success: false,
        error: '找不到用戶的 Reply Token'
      });
    }
    
    const messageText = message || pendingTask.messageText || '測試訊息';
    const success = await replyToLineUser(pendingTask.replyToken, messageText);
    
    if (success) {
      pendingTasks.delete(userId);
    }
    
    res.json({
      success: success,
      message: success ? '回復發送成功' : '回復發送失敗',
      userId: userId
    });
    
  } catch (error) {
    console.error('❌ 手動回復失敗:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 下載路由保持不變
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
      })),
      zipDownloadUrl: `/api/download/images/${folderName}/zip`
    });

  } catch (error) {
    console.error('❌ 列出圖片失敗:', error);
    res.status(500).json({ error: '無法存取圖片資料夾' });
  }
});

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

app.get('/api/download/images/:folder/:filename', (req, res) => {
  const folderName = req.params.folder;
  const filename = req.params.filename;
  const filePath = path.join(imageDir, folderName, filename);
  
  console.log('🖼️ 圖片下載請求:', filePath);
  
  if (!fs.existsSync(filePath)) {
    const folderPath = path.join(imageDir, folderName);
    if (fs.existsSync(folderPath)) {
      try {
        const files = fs.readdirSync(folderPath);
        const similarFiles = files.filter(f => f.includes(path.parse(filename).name));
        
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

// 清理過期的待處理任務
setInterval(() => {
  const now = Date.now();
  const expiredThreshold = 30 * 60 * 1000; // 30分鐘
  
  for (const [userId, task] of pendingTasks.entries()) {
    if (now - task.timestamp > expiredThreshold) {
      console.log('🗑️ 清理過期任務:', userId);
      pendingTasks.delete(userId);
    }
  }
}, 5 * 60 * 1000); // 每5分鐘清理一次

// 伺服器初始化
const initializeServer = async () => {
  await loadConversionModules();
  
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log('🎉 改進的文件轉換伺服器啟動成功！');
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
    console.log(`📁 資料夾:`);
    console.log(`   📤 上傳: ${uploadDir}`);
    console.log(`   📄 PDF: ${pdfDir}`);
    console.log(`   🖼️ 圖片: ${imageDir}`);
    console.log(`🔧 轉換功能:`);
    console.log(`   📄 DOC/DOCX → PDF: ${libreOfficeConvert ? '✅' : '❌ (只支援 PDF 上傳)'}`);
    console.log(`   🖼️ PDF → 圖片: ${pdf2pic ? '✅' : '❌ (只支援 PDF 下載)'}`);
    console.log(`📱 LINE 整合:`);
    console.log(`   🎯 Webhook: /webhook/line`);
    console.log(`   💬 Reply 功能: ✅`);
    console.log(`   🎫 Reply Token 管理: ✅`);
    console.log(`🌐 N8N 通知: ${process.env.N8N_WEBHOOK_URL || '未設定'}`);
    console.log('================================');
    
    console.log('✨ 改進的系統流程：');
    console.log('   1️⃣ 用戶發送 LINE 訊息');
    console.log('   2️⃣ 系統儲存真實 Reply Token');
    console.log('   3️⃣ 用戶上傳文件');
    console.log('   4️⃣ 文件轉換處理');
    console.log('   5️⃣ 使用真實 Reply Token 回復');
    console.log('   6️⃣ 同時發送通知到 N8N');
    console.log('================================');
    
    console.log('🧪 測試端點：');
    console.log('   POST /webhook/line - LINE Webhook 接收');
    console.log('   POST /api/test-notification - 測試 N8N 通知');
    console.log('   GET /api/pending-tasks - 查看待處理任務');
    console.log('   POST /api/manual-reply/:userId - 手動回復測試');
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

initializeServer().catch(error => {
  console.error('❌ 伺服器初始化失敗:', error);
  process.exit(1);
}); = await sendNotificationToN8N(notificationData);

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
        message: '檔案轉換完成',
        fileName: req.file.originalname,
        notification: {
          sent: n8nResult.success,
          error: n8nResult.error
        },
        conversions: {
          pdfGenerated: true,
          imagesGenerated: conversionResult.imageFiles.count > 0
        }
      };

      console.log('🏁 轉換流程完成:', {
        檔案: req.file.originalname,
        'PDF': conversionResult.pdfFile.name,
        '圖片數': conversionResult.imageFiles.count,
        'N8N通知': n8nResult.success ? '✅' : '❌',
        '用戶任務': userId && pendingTasks.has(userId) ? '已更新' : '無'
      });

      res.json(result);

    } catch (error) {
      console.error('❌ 處理錯誤:', error);
      
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

// 測試通知 API
app.post('/api/test-notification', async (req, res) => {
  try {
    console.log('🧪 測試通知功能');
    
    const { userId, fileName } = req.body;
    
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
    
    const notificationData = createFileConversionNotification(
      userId || 'test-user',
      fileName || 'test-document.pdf',
      mockConversionResult
    );
    
    const n8nResult
