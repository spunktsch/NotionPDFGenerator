const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const app = express();
const PORT = 3000;

// Set up multer for file uploads (limit to 100MB, only ZIPs)
const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
            cb(null, true);
        } else {
            cb(new Error('Only ZIP files are allowed.'));
        }
    }
});

app.use(express.urlencoded({ extended: true }));

const htmlTemplate = (body) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Notion PDF Generator</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f6f8fa; margin: 0; padding: 0; }
        .container { max-width: 480px; margin: 60px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 32px 36px 28px 36px; }
        h2 { margin-top: 0; color: #2d3748; font-weight: 600; }
        label { font-size: 1rem; color: #4a5568; }
        input[type="file"] { margin-top: 12px; margin-bottom: 24px; }
        button { background: #2b6cb0; color: #fff; border: none; padding: 10px 28px; border-radius: 6px; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #2c5282; }
        .msg { margin-top: 18px; padding: 12px 16px; border-radius: 6px; background: #e6fffa; color: #234e52; border: 1px solid #b2f5ea; font-size: 1rem; }
        .error { background: #fff5f5; color: #c53030; border: 1px solid #feb2b2; }
        .footer { margin-top: 32px; text-align: center; color: #a0aec0; font-size: 0.95rem; }
    </style>
</head>
<body>
    <div class="container">
        ${body}
    </div>
    <div class="footer">
        &copy; ${new Date().getFullYear()} Notion PDF Generator
    </div>
</body>
</html>
`;

// Helper to recursively find all HTML files, but prefer root .html if it's the only one
function findHtmlFiles(dir, baseDir) {
    let results = [];
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const relPath = path.relative(baseDir, fullPath);
        if (fs.statSync(fullPath).isDirectory()) {
            results = results.concat(findHtmlFiles(fullPath, baseDir));
        } else if (file.toLowerCase().endsWith('.html')) {
            results.push(relPath);
        }
    }
    return results;
}

// Helper to run PDF generation and handle response
function generatePDFAndRespond(entryPath, tempDir, res) {
    const entryUrl = 'file://' + encodeURI(entryPath);
    const exportPath = path.join(__dirname, 'out', 'Export.pdf');
    if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath);

    const scriptPath = path.join(__dirname, 'index.js');
    const nodePath = process.execPath;

    execFile(nodePath, [scriptPath, entryUrl], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
        // Always clean up tempDir
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        if (err) {
            return res.send(htmlTemplate(`<div class="msg error"><b>PDF Generation Error:</b> ${err.message}<br><pre>${stderr}</pre><br><b>Output:</b><br><pre>${stdout}</pre></div>`));
        }
        if (!fs.existsSync(exportPath)) {
            return res.send(htmlTemplate(`<div class="msg error">PDF generation failed. No output file found.<br><b>Details:</b><br><pre>${stderr}</pre><br><b>Output:</b><br><pre>${stdout}</pre></div>`));
        }
        res.send(htmlTemplate(`
            <div class="msg">
                <b>PDF generated successfully!</b><br>
                <a href="/download" style="color:#2b6cb0;text-decoration:underline;">Download Export.pdf</a>
            </div>
            <form method="GET" action="/">
                <button type="submit" style="margin-top:18px;">Back</button>
            </form>
        `));
    });
}

app.get('/', (req, res) => {
    res.send(htmlTemplate(`
        <h2>Notion PDF Generator</h2>
        <form method="POST" action="/upload" enctype="multipart/form-data">
            <label>Upload ZIP containing your Notion HTML export:</label><br>
            <input type="file" name="zipfile" accept=".zip" required><br>
            <button type="submit">Generate PDF</button>
        </form>
    `));
});

app.post('/upload', upload.single('zipfile'), async (req, res) => {
    if (!req.file) {
        return res.send(htmlTemplate(`<div class="msg error">No file uploaded.</div>`));
    }

    // Create a unique temp directory for this job
    const tempDir = path.join(os.tmpdir(), 'notionpdf_' + crypto.randomBytes(8).toString('hex'));
    fs.mkdirSync(tempDir);

    // Unzip the uploaded file and wait for extraction to finish
    try {
        await fs.createReadStream(req.file.path)
            .pipe(unzipper.Extract({ path: tempDir }))
            .promise();
    } catch (err) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(req.file.path);
        return res.send(htmlTemplate(`<div class="msg error">Failed to unzip file: ${err.message}</div>`));
    }

    // Clean up uploaded ZIP file (but keep extracted files for now)
    fs.unlinkSync(req.file.path);

    // List all HTML files
    const htmlFiles = findHtmlFiles(tempDir, tempDir);

    if (htmlFiles.length === 0) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return res.send(htmlTemplate(`<div class="msg error">No HTML files found in ZIP.</div>`));
    }

    // Filter to only HTML files in the root directory (no subdirectories)
    const rootHtmlFiles = htmlFiles.filter(file => !file.includes(path.sep));
    
    // If there are HTML files in the root, sort alphabetically and select the first one
    if (rootHtmlFiles.length > 0) {
        rootHtmlFiles.sort(); // Sort alphabetically to get the "topmost" file
        const entryHtml = rootHtmlFiles[0];
        const entryPath = path.join(tempDir, entryHtml);
        return generatePDFAndRespond(entryPath, tempDir, res);
    }

    // If no files in root, show selection UI with all files
    res.send(htmlTemplate(`
        <h2>Select Entry HTML File</h2>
        <form method="POST" action="/generate">
            <input type="hidden" name="tempDir" value="${tempDir}">
            ${htmlFiles.map((file, idx) => `
                <div>
                    <input type="radio" id="file${idx}" name="entryHtml" value="${file}" ${idx === 0 ? 'checked' : ''}>
                    <label for="file${idx}">${file}</label>
                </div>
            `).join('')}
            <button type="submit" style="margin-top:18px;">Generate PDF</button>
        </form>
        <form method="GET" action="/">
            <button type="submit" style="margin-top:18px;">Back</button>
        </form>
    `));
});

app.post('/generate', (req, res) => {
    const tempDir = req.body.tempDir;
    const entryHtml = req.body.entryHtml;
    if (!tempDir || !entryHtml) {
        return res.send(htmlTemplate(`<div class="msg error">Missing data for PDF generation.</div>`));
    }

    const entryPath = path.join(tempDir, entryHtml);
    if (!fs.existsSync(entryPath)) {
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        return res.send(htmlTemplate(`<div class="msg error">Selected HTML file not found.</div>`));
    }

    return generatePDFAndRespond(entryPath, tempDir, res);
});

app.get('/download', (req, res) => {
    const exportPath = path.join(__dirname, 'out', 'Export.pdf');
    if (!fs.existsSync(exportPath)) {
        return res.send(htmlTemplate(`<div class="msg error">No PDF available for download. Please upload and generate first.</div>`));
    }
    res.download(exportPath, 'Export.pdf');
});

app.listen(PORT, () => {
    console.log(`Webapp running at http://localhost:${PORT}`);
});
