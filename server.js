// 修改 server.js 中的相關函數

// 模擬用戶發送 PostBack 訊息到自己的 Webhook
async function simulateUserPostbackToWebhook(userId, downloadUrl, fileName, fileSize) {
  try {
    console.log('🎭 模擬用戶發送 PostBack 訊息到 Webhook');
    
    // 構造模擬的 LINE Webhook 事件
    const mockWebhookEvent = {
      events: [
        {
          type: 'postback',
          mode: 'active',
          timestamp: Date.now(),
          source: {
            type: 'user',
            userId: userId
          },
          postback: {
            data: JSON.stringify({
              action: 'file_uploaded',
              fileName: fileName,
              downloadUrl: downloadUrl,
              fileSize: fileSize,
              uploadTime: new Date().toISOString(),
              source: 'file_upload_system'
            }),
            params: {}
          },
          replyToken: 'mock_reply_token_' + Date.now()
        }
      ],
      destination: process.env.LINE_BOT_USER_ID || 'mock_destination'
    };

    console.log('📤 模擬 Webhook 事件:', JSON.stringify(mockWebhookEvent, null, 2));
    
    // 方法 1: 直接調用本地 Webhook 處理函數
    await processWebhookEvent(mockWebhookEvent);
    
    // 方法 2: 發送 HTTP 請求到自己的 Webhook（可選）
    if (process.env.SIMULATE_HTTP_WEBHOOK === 'true') {
      await sendHttpWebhookRequest(mockWebhookEvent);
    }
    
    return true;
  } catch (error) {
    console.error('❌ 模擬 PostBack 失敗:', error);
    return false;
  }
}

// 直接處理 Webhook 事件（不通過 HTTP）
async function processWebhookEvent(webhookData) {
  try {
    console.log('🔄 直接處理模擬的 Webhook 事件');
    
    const events = webhookData.events || [];
    
    for (const event of events) {
      const userId = event.source.userId;
      
      if (event.type === 'postback') {
        console.log('📨 處理模擬 PostBack:', event.postback.data);
        
        const postbackData = JSON.parse(event.postback.data);
        
        // 根據不同的 action 處理不同邏輯
        switch (postbackData.action) {
          case 'file_uploaded':
            await handleUserFileUpload(userId, postbackData);
            break;
            
          case 'request_file_analysis':
            await handleFileAnalysisRequest(userId, postbackData);
            break;
            
          case 'share_download_link':
            await handleShareDownloadLink(userId, postbackData);
            break;
            
          default:
            console.log('❓ 未知的模擬 PostBack 動作:', postbackData.action);
        }
      }
    }
    
  } catch (error) {
    console.error('❌ 處理模擬 Webhook 事件失敗:', error);
  }
}

// 發送 HTTP 請求到自己的 Webhook（可選方法）
async function sendHttpWebhookRequest(webhookData) {
  try {
    const webhookUrl = process.env.FRONTEND_URL ? 
      `${process.env.FRONTEND_URL}/api/webhook` : 
      `http://localhost:${PORT}/api/webhook`;
    
    console.log('🌐 發送模擬 HTTP Webhook 請求到:', webhookUrl);
    
    const response = await axios.post(webhookUrl, webhookData, {
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': 'mock_signature', // 模擬簽名
        'user-agent': 'line-webhook-simulator'
      },
      timeout: 5000
    });
    
    console.log('✅ HTTP Webhook 請求成功:', response.status);
    
  } catch (error) {
    console.error('❌ HTTP Webhook 請求失敗:', error.message);
  }
}

// 處理用戶檔案上傳事件
async function handleUserFileUpload(userId, data) {
  try {
    console.log(`👤 用戶 ${userId} 上傳了檔案: ${data.fileName}`);
    console.log('📊 檔案資訊:', {
      fileName: data.fileName,
      fileSize: `${(data.fileSize / 1024 / 1024).toFixed(2)} MB`,
      downloadUrl: data.downloadUrl,
      uploadTime: data.uploadTime
    });
    
    // 在這裡處理你的業務邏輯
    // 例如：記錄到資料庫、發送通知、觸發其他系統等
    
    // 可以回應給用戶（如果需要的話）
    if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      await sendResponseToUser(userId, 
        `✅ 收到您上傳的檔案「${data.fileName}」\n\n` +
        `📊 檔案大小: ${(data.fileSize / 1024 / 1024).toFixed(2)} MB\n` +
        `🕐 上傳時間: ${new Date(data.uploadTime).toLocaleString('zh-TW')}\n\n` +
        `🤖 系統正在處理您的檔案...`
      );
      
      // 模擬處理時間後發送完成通知
      setTimeout(async () => {
        await sendResponseToUser(userId, 
          `🎉 檔案「${data.fileName}」處理完成！\n\n` +
          `📥 下載連結: ${data.downloadUrl}`
        );
      }, 3000);
    }
    
  } catch (error) {
    console.error('❌ 處理用戶檔案上傳失敗:', error);
  }
}

// 處理檔案分析請求
async function handleFileAnalysisRequest(userId, data) {
  console.log(`🔍 用戶 ${userId} 請求分析檔案: ${data.fileName}`);
  
  // 模擬檔案分析
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    await sendResponseToUser(userId, 
      `🔍 正在分析檔案「${data.fileName}」...\n\n` +
      `📊 預估分析時間: 30秒`
    );
    
    setTimeout(async () => {
      await sendResponseToUser(userId, 
        `📋 檔案分析結果:\n` +
        `• 檔案類型: ${path.extname(data.fileName).toUpperCase()}\n` +
        `• 檔案大小: ${(data.fileSize / 1024 / 1024).toFixed(2)} MB\n` +
        `• 安全性檢查: ✅ 通過\n` +
        `• 內容完整性: ✅ 良好`
      );
    }, 5000);
  }
}

// 處理分享下載連結請求
async function handleShareDownloadLink(userId, data) {
  console.log(`📤 用戶 ${userId} 請求分享檔案連結: ${data.fileName}`);
  
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    await sendResponseToUser(userId, 
      `📋 檔案分享連結已準備好:\n\n` +
      `📁 檔案名稱: ${data.fileName}\n` +
      `🔗 下載連結: ${data.downloadUrl}\n\n` +
      `💡 此連結可以分享給其他人下載檔案`
    );
  }
}

// 發送回應給用戶
async function sendResponseToUser(userId, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
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
    
    console.log('📤 回應訊息已發送給用戶');
  } catch (error) {
    console.error('❌ 發送回應失敗:', error.response?.data || error.message);
  }
}

// 修改檔案上傳 API
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

      const baseUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`;
      const downloadUrl = `${baseUrl}/api/download/${req.file.filename}`;

      const result = {
        success: true,
        fileName: req.file.originalname,
        savedName: req.file.filename,
        fileSize: req.file.size,
        downloadUrl: downloadUrl,
        uploadTime: new Date().toISOString()
      };

      // 🎭 模擬用戶發送 PostBack 訊息到 Webhook
      const userId = req.body.userId;
      if (userId) {
        console.log('🎭 開始模擬用戶 PostBack 訊息');
        result.webhookSimulated = await simulateUserPostbackToWebhook(
          userId, 
          downloadUrl, 
          req.file.originalname, 
          req.file.size
        );
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

// 增強的 Webhook 處理 - 能識別模擬事件
app.post('/api/webhook', async (req, res) => {
  const isSimulated = req.headers['user-agent'] === 'line-webhook-simulator';
  
  console.log(`📨 收到 ${isSimulated ? '模擬的' : '真實的'} LINE Webhook:`, 
    JSON.stringify(req.body, null, 2));
  
  try {
    const events = req.body.events || [];
    
    for (const event of events) {
      const userId = event.source.userId;
      
      if (event.type === 'postback') {
        console.log(`🔄 處理 ${isSimulated ? '模擬的' : '真實的'} PostBack:`, 
          event.postback.data);
        
        const postbackData = JSON.parse(event.postback.data);
        
        // 根據來源區分處理邏輯
        if (postbackData.source === 'file_upload_system') {
          console.log('🎯 這是檔案上傳系統模擬的 PostBack');
        }
        
        switch (postbackData.action) {
          case 'file_uploaded':
            await handleUserFileUpload(userId, postbackData);
            break;
            
          case 'request_file_analysis':
            await handleFileAnalysisRequest(userId, postbackData);
            break;
            
          case 'share_download_link':
            await handleShareDownloadLink(userId, postbackData);
            break;
            
          // 原有的其他 PostBack 處理...
          case 'get_download_link':
          case 'copy_link':
          case 'delete_file':
            // 保持原有邏輯
            break;
            
          default:
            console.log('❓ 未知的 PostBack 動作:', postbackData.action);
        }
      }
      
      // 處理文字訊息
      if (event.type === 'message' && event.message.type === 'text') {
        const messageText = event.message.text.toLowerCase();
        
        if (messageText.includes('檔案') || messageText.includes('下載')) {
          await sendResponseToUser(userId, 
            '🤖 您是想要上傳檔案嗎？\n\n' +
            `請使用我們的上傳系統：\n${process.env.FRONTEND_URL || 'http://localhost:' + PORT}`
          );
        }
      }
    }
    
    res.status(200).json({ status: 'ok' });
    
  } catch (error) {
    console.error('❌ Webhook 處理錯誤:', error);
    res.status(200).json({ status: 'error' });
  }
});

// 新增測試模擬 PostBack 的 API
app.post('/api/simulate-postback', async (req, res) => {
  try {
    const { userId, action, fileName, downloadUrl, fileSize } = req.body;
    
    if (!userId || !action) {
      return res.status(400).json({ error: '需要 userId 和 action' });
    }
    
    console.log('🧪 測試模擬 PostBack');
    
    const result = await simulateUserPostbackToWebhook(
      userId, 
      downloadUrl || 'https://example.com/test.pdf',
      fileName || 'test.pdf',
      fileSize || 1024000
    );
    
    res.json({ 
      success: result, 
      message: result ? '模擬 PostBack 成功' : '模擬 PostBack 失敗'
    });
    
  } catch (error) {
    console.error('❌ 測試模擬 PostBack 失敗:', error);
    res.status(500).json({ error: error.message });
  }
});

// 環境變數說明
console.log('🔧 模擬 PostBack 設定:');
console.log('  SIMULATE_HTTP_WEBHOOK:', process.env.SIMULATE_HTTP_WEBHOOK || 'false');
console.log('  LINE_BOT_USER_ID:', process.env.LINE_BOT_USER_ID || '未設定');
console.log('  LINE_CHANNEL_ACCESS_TOKEN:', process.env.LINE_CHANNEL_ACCESS_TOKEN ? '已設定' : '未設定');
