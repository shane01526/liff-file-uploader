import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { fromPath } from 'pdf2pic';
import fetch from 'node-fetch';
import FormData from 'form-data';

const app = express();
const upload = multer({ dest: 'uploads/' });

// 上傳 API
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        const filePath = req.file.path;
        const originalExt = path.extname(req.file.originalname).toLowerCase();
        const pdfPath = path.join('uploads', `${Date.now()}.pdf`);

        // Step 1: 轉成 PDF
        if (originalExt !== '.pdf') {
            await convertToPDF(filePath, pdfPath);
        } else {
            fs.renameSync(filePath, pdfPath);
        }

        // Step 2: PDF → 圖片
        const imageDir = path.join('uploads', `${Date.now()}_images`);
        fs.mkdirSync(imageDir);
        await convertPDFToImages(pdfPath, imageDir);

        // Step 3: 發送到 n8n webhook
        const formData = new FormData();
        formData.append('pdf', fs.createReadStream(pdfPath));

        const imageFiles = fs.readdirSync(imageDir);
        for (const file of imageFiles) {
            formData.append('images', fs.createReadStream(path.join(imageDir, file)));
        }

        const n8nResponse = await fetch('https://acd708f660a3.ngrok-free.app/webhook-test/1234', {
            method: 'POST',
            body: formData
        });

        if (!n8nResponse.ok) throw new Error('n8n webhook 請求失敗');

        const n8nResult = await n8nResponse.json();

        // Step 4: 回傳 n8n 結果給前端
        res.json({
            success: true,
            n8nData: n8nResult
        });

        // Step 5: 刪除暫存檔案
        cleanupFiles([pdfPath, ...imageFiles.map(f => path.join(imageDir, f))]);
        fs.rmSync(imageDir, { recursive: true, force: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '轉換失敗' });
    }
});

// 工具函式
function convertToPDF(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        exec(`libreoffice --headless --convert-to pdf "${inputPath}" --outdir uploads`, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function convertPDFToImages(pdfPath, outputDir) {
    return new Promise((resolve, reject) => {
        const options = { density: 150, saveFilename: "page", savePath: outputDir, format: "png", width: 1024, height: 768 };
        const storeAsImage = fromPath(pdfPath, options);
        storeAsImage.bulk(-1)
            .then(() => resolve())
            .catch(reject);
    });
}

function cleanupFiles(filePaths) {
    filePaths.forEach(file => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    });
}

app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
});
