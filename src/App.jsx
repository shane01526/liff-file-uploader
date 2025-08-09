import React, { useEffect, useState } from 'react'

export default function App() {
  const [userId, setUserId] = useState('')
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    window.liff.init({ liffId: import.meta.env.VITE_LIFF_ID }).then(() => {
      if (!window.liff.isLoggedIn()) {
        window.liff.login()
      } else {
        const profile = window.liff.getDecodedIDToken()
        setUserId(profile.sub)
      }
    }).catch((err) => {
      setStatus('LIFF 初始化錯誤：' + err.message)
    })
  }, [])

  const handleUpload = async () => {
    if (!file) {
      setStatus('請選擇檔案')
      return
    }
    setStatus('上傳中...')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('userId', userId)

      const res = await fetch(import.meta.env.VITE_WEBHOOK_URL, {
        method: 'POST',
        body: formData
      })
      if (res.ok) {
        setStatus('✅ 上傳成功')
      } else {
        setStatus('❌ 上傳失敗')
      }
    } catch (error) {
      setStatus('❌ 上傳錯誤')
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: 'auto', padding: 20 }}>
      <h2>📎 LIFF 檔案上傳</h2>
      <input
        type="file"
        accept=".pdf,.doc,.docx,.jpg,.png"
        onChange={e => setFile(e.target.files[0])}
        style={{ marginBottom: 16 }}
      />
      <button onClick={handleUpload}>上傳</button>
      <p>{status}</p>
    </div>
  )
}
