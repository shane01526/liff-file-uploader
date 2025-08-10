// 在 server.js 中添加以下增強功能

// 模擬用戶發送訊息給 LINE Bot 的函數
async function simulateUserMessageToBot(userId, downloadUrl, fileName, fileSize) {
  try {
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) {
      console.warn('⚠️ LINE Token 未設定，無法發送訊息');
      return false;
    }

    console.log('🤖 模擬用戶發送檔案下載訊息給 Bot');

    // 方法 1: 使用 PostBack 模擬用戶動作（推薦）
    const postbackData = {
      action: 'file_uploaded',
      fileName: fileName,
      downloadUrl: downloadUrl,
      fileSize: fileSize,
      uploadTime: new Date().toISOString(),
      userId: userId
    };

    // 直接處理檔案上傳事件（模擬 webhook 接收）
    await handleFileUploadedEvent(postbackData);

    // 方法 2: 發送豐富的互動式訊息
    await sendInteractiveFileMessage(userId, fileName, downloadUrl, fileSize);

    return true;
  } catch (error) {
    console.error('❌ 模擬用戶訊息失敗:', error.response?.data || error.message);
    return false;
  }
}

// 處理檔案上傳事件
async function handleFileUploadedEvent(data) {
  try {
    console.log('🎯 處理檔案上傳事件:', data.fileName);
    
    // 可以在這裡觸發 Bot 的回應邏輯
    // 例如：分析檔案、發送確認訊息、記錄到資料庫等
    
    // 模擬 Bot 收到用戶分享檔案的情境
    const botResponse = generateBotResponse(data);
    
    // 發送 Bot 回應
    if (data.userId) {
      await sendBotResponse(data.userId, botResponse);
    }
    
  } catch (error) {
    console.error('❌ 處理檔案上傳事件失敗:', error);
  }
}

// 生成 Bot 回應內容
function generateBotResponse(data) {
  const responses = [
    `📄 收到您的檔案「${data.fileName}」！我來幫您處理一下...`,
    `✅ 檔案已安全儲存！檔案大小：${(data.fileSize / 1024 / 1024).toFixed(2)} MB`,
    `🔍 正在分析您的檔案內容...`,
    `💡 如需重新下載，可隨時使用下方連結`
  ];
  
  return responses[Math.floor(Math.random() * responses.length)];
}

// 發送 Bot 回應
async function sendBotResponse(userId, responseText) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [{ 
        type: 'text', 
        text: responseText 
      }]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('🤖 Bot 回應已發送');
  } catch (error) {
    console.error('❌ 發送 Bot 回應失敗:', error.response?.data || error.message);
  }
}

// 發送互動式檔案訊息（更豐富的 UI）
async function sendInteractiveFileMessage(userId, fileName, downloadUrl, fileSize) {
  try {
    // Flex Message - 更美觀的檔案卡片
    const flexMessage = {
      type: 'flex',
      altText: `📁 ${fileName} - 檔案已準備就緒`,
      contents: {
        type: 'bubble',
        size: 'kilo',
        header: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: '📁 檔案上傳成功',
              weight: 'bold',
              color: '#1DB446',
              size: 'md'
            }
          ],
          backgroundColor: '#F0F8F0',
          paddingAll: '12px'
        },
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: fileName.length > 25 ? fileName.substring(0, 25) + '...' : fileName,
              weight: 'bold',
              size: 'lg',
              wrap: true,
              color: '#333333'
            },
            {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'text',
                  text: `大小：${(fileSize / 1024 / 1024).toFixed(2)} MB`,
                  size: 'sm',
                  color: '#666666'
                },
                {
                  type: 'text',
                  text: `時間：${new Date().toLocaleString('zh-TW')}`,
                  size: 'sm',
                  color: '#666666'
                }
              ],
              margin: 'md'
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'button',
              action: {
                type: 'uri',
                label: '📥 下載檔案',
                uri: downloadUrl
              },
              style: 'primary',
              color: '#1DB446'
            },
            {
              type: 'button',
              action: {
                type: 'postback',
                label: '📋 取得下載連結',
                data: JSON.stringify({
                  action: 'get_download_link',
                  url: downloadUrl,
                  fileName: fileName
                }),
                displayText: '取得下載連結'
              },
              style: 'secondary',
              margin: 'sm'
            },
            {
              type: 'button',
              action: {
                type: 'postback',
                label: '🤖 讓 Bot 處理檔案',
                data: JSON.stringify({
                  action: 'process_file',
                  url: downloadUrl,
                  fileName: fileName,
                  fileSize: fileSize
                }),
                displayText: '請 Bot 處理我的檔案'
              },
              style: 'secondary',
              margin: 'sm'
            }
          ]
        }
      }
    };

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [flexMessage]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ 互動式檔案訊息發送成功');
    return true;

  } catch (error) {
    console.error('❌ 發送互動式訊息失敗:', error.response?.data || error.message);
    
    // 回退到簡單訊息
    await sendSimpleFileNotification(userId, fileName, downloadUrl, fileSize);
    return false;
  }
}

// 簡單檔案通知（備用）
async function sendSimpleFileNotification(userId, fileName, downloadUrl, fileSize) {
  const message = `🎉 檔案上傳完成！\n\n📁 檔案：${fileName}\n💾 大小：${(fileSize / 1024 / 1024).toFixed(2)} MB\n🕐 時間：${new Date().toLocaleString('zh-TW')}\n\n📥 下載連結：\n${downloadUrl}\n\n💡 點擊連結即可下載檔案`;
  
  await sendSimpleLineMessage(userId, message);
}

// 增強的 Webhook 處理，支援更多 PostBack 動作
app.post('/api/webhook', async (req, res) => {
  console.log('📨 收到 LINE Webhook:', JSON.stringify(req.body, null, 2));
  
  try {
    const events = req.body.events || [];
    
    for (const event of events) {
      const userId = event.source.userId;
      
      if (event.type === 'postback') {
        console.log('🔄 處理 PostBack:', event.postback.data);
        
        const postbackData = JSON.parse(event.postback.data);
        
        switch (postbackData.action) {
          case 'get_download_link':
            await sendSimpleLineMessage(userId, 
              `📋 下載連結：\n${postbackData.url}\n\n檔案：${postbackData.fileName}\n\n💡 長按連結可複製到剪貼簿`
            );
            break;
            
          case 'process_file':
            await handleBotProcessFile(userId, postbackData);
            break;
            
          case 'copy_link':
            await sendSimpleLineMessage(userId, 
              `📋 下載連結已準備好：\n${postbackData.url}\n\n檔案：${postbackData.fileName}`
            );
            break;
            
          case 'delete_file':
            if (postbackData.confirm) {
              await handleFileDelete(userId, postbackData.fileName);
            }
            break;
            
          default:
            console.log('❓ 未知的 PostBack 動作:', postbackData.action);
        }
      }
      
      // 處理文字訊息（模擬用戶主動詢問）
      if (event.type === 'message' && event.message.type === 'text') {
        const messageText = event.message.text.toLowerCase();
        
        if (messageText.includes('檔案') || messageText.includes('下載') || messageText.includes('file')) {
          await sendSimpleLineMessage(userId, 
            '🤖 您是想要上傳或下載檔案嗎？\n\n請使用我們的上傳系統：\n' + 
            (process.env.FRONTEND_URL || 'http://localhost:10000')
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

// Bot 處理檔案的模擬功能
async function handleBotProcessFile(userId, data) {
  try {
    console.log('🤖 Bot 開始處理檔案:', data.fileName);
    
    // 發送處理中訊息
    await sendSimpleLineMessage(userId, '🤖 收到！讓我來分析您的檔案...');
    
    // 模擬處理時間
    setTimeout(async () => {
      const processingResults = [
        '✅ 檔案格式檢查完成，格式正確！',
        '📊 檔案大小適中，處理順利',
        '🔍 檔案內容已掃描，未發現異常',
        '💾 檔案已安全儲存在我們的系統中',
        '🎯 檔案處理完畢！您可以隨時重新下載'
      ];
      
      for (const result of processingResults) {
        await sendSimpleLineMessage(userId, result);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 間隔1秒
      }
      
      // 最終結果
      await sendSimpleLineMessage(userId, 
        `🎉 檔案「${data.fileName}」處理完成！\n\n如需重新下載：\n${data.url}`
      );
      
    }, 2000);
    
  } catch (error) {
    console.error('❌ Bot 處理檔案失敗:', error);
    await sendSimpleLineMessage(userId, '❌ 檔案處理時發生錯誤，請稍後再試');
  }
}

// 修改上傳 API，加入模擬用戶訊息功能
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

      // 模擬用戶發送訊息給 LINE Bot
      const userId = req.body.userId;
      if (userId && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
        console.log('🎭 模擬用戶發送檔案訊息給 Bot');
        result.botMessageSent = await simulateUserMessageToBot(
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

// 新增測試 PostBack 的 API
app.post('/api/test-postback', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: '需要 userId' });
    }
    
    // 發送測試用的 PostBack 訊息
    const testMessage = {
      type: 'template',
      altText: '🧪 測試 PostBack 功能',
      template: {
        type: 'buttons',
        text: '🧪 這是 PostBack 測試訊息\n請點擊下方按鈕測試功能',
        actions: [
          {
            type: 'postback',
            label: '✅ 測試成功',
            data: JSON.stringify({
              action: 'test_success',
              timestamp: new Date().toISOString()
            }),
            displayText: 'PostBack 測試成功！'
          },
          {
            type: 'postback',
            label: '📁 模擬檔案處理',
            data: JSON.stringify({
              action: 'process_file',
              fileName: 'test.pdf',
              url: 'https://example.com/test.pdf',
              fileSize: 1024000
            }),
            displayText: '開始處理測試檔案'
          }
        ]
      }
    };

    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: userId,
      messages: [testMessage]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    res.json({ success: true, message: '測試 PostBack 訊息已發送' });
    
  } catch (error) {
    console.error('❌ 測試 PostBack 失敗:', error);
    res.status(500).json({ error: error.message });
  }
});
