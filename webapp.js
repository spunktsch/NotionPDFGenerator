const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const fss = require('fs');
const unzipper = require('unzipper');
const os = require('os');
const crypto = require('crypto');
const generatePdf = require('./pdfGenerator');

const app = express();
const PORT = 3000;

// Set up multer for file uploads
const upload = multer({ dest: os.tmpdir() });

const htmlTemplate = (body) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Notion PDF Generator</title>
    <style>
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            background: #f6f8fa;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 480px;
            margin: 60px auto;
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 2px 12px rgba(0,0,0,0.08);
            padding: 32px 36px 28px 36px;
        }
        h2 {
            margin-top: 0;
            color: #2d3748;
            font-weight: 600;
        }
        label {
            font-size: 1rem;
            color: #4a5568;
        }
        input[type="file"] {
            margin-top: 12px;
            margin-bottom: 24px;
        }
        button {
            background: #2b6cb0;
            color: #fff;
            border: none;
            padding: 10px 28px;
            border-radius: 6px;
            font-size: 1rem;
            cursor: pointer;
            transition: background 0.2s;
        }
        button:hover {
            background: #2c5282;
        }
        .msg {
            margin-top: 18px;
            padding: 12px 16px;
            border-radius: 6px;
            background: #e6fffa;
            color: #234e52;
            border: 1px solid #b2f5ea;
            font-size: 1rem;
        }
        .error {
            background: #fff5f5;
            color: #c53030;
            border: 1px solid #feb2b2;
        }
        .footer {
            margin-top: 32px;
            text-align: center;
            color: #a0aec0;
            font-size: 0.95rem;
        }
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

// Helper to recursively find all HTML files, but prefer root .html if it's the only one
async function findHtmlFiles(dir, baseDir) {
    let results = [];
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        const relPath = path.relative(baseDir, fullPath);
        if (file.isDirectory()) {
            results = results.concat(await findHtmlFiles(fullPath, baseDir));
        } else if (file.name.toLowerCase().endsWith('.html')) {
            results.push(relPath);
        }
    }
    return results;
}

app.post('/upload', upload.single('zipfile'), async (req, res) => {
    if (!req.file) {
        return res.send(htmlTemplate(`<div class="msg error">No file uploaded.</div>`));
    }

    // Create a unique temp directory for this job
    const tempDir = path.join(os.tmpdir(), 'notionpdf_' + crypto.randomBytes(8).toString('hex'));
    await fs.mkdir(tempDir);

    // Unzip the uploaded file and wait for extraction to finish
    try {
        await fss.createReadStream(req.file.path)
            .pipe(unzipper.Extract({ path: tempDir }))
            .promise();
    } catch (err) {
        await fs.rm(tempDir, { recursive: true, force: true });
        await fs.unlink(req.file.path);
        return res.send(htmlTemplate(`<div class="msg error">Failed to unzip file: ${err.message}</div>`));
    }

    // List all HTML files for user selection
    const htmlFiles = await findHtmlFiles(tempDir, tempDir);

    // If there is only one .html file and it's in the root, auto-select and proceed to PDF generation
    if (
        htmlFiles.length === 1 &&
        !htmlFiles[0].includes(path.sep) // no subdirectory in path
    ) {
        // Auto-generate PDF using this file
        const entryHtml = htmlFiles[0];
        const entryPath = path.join(tempDir, entryHtml);
        const entryUrl = 'file://' + encodeURI(entryPath);
        const exportPath = path.join(__dirname, 'out', 'Export.pdf');
        if (fss.existsSync(exportPath)) await fs.unlink(exportPath);

        try {
            await generatePdf(entryUrl, { outputDir: path.join(__dirname, 'out') });
            await fs.rm(tempDir, { recursive: true, force: true });
            return res.send(htmlTemplate(`
                <div class="msg">
                    <b>PDF generated successfully!</b><br>
                    <a href="/download" style="color:#2b6cb0;text-decoration:underline;">Download Export.pdf</a>
                </div>
                <form method="GET" action="/">
                    <button type="submit" style="margin-top:18px;">Back</button>
                </form>
            `));
        } catch (err) {
            await fs.rm(tempDir, { recursive: true, force: true });
            return res.send(htmlTemplate(`<div class="msg error"><b>Error:</b> ${err.message}</div>`));
        }
        return;
    }

    // Otherwise, show selection UI
    if (htmlFiles.length === 0) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return res.send(htmlTemplate(`<div class="msg error">No HTML files found in ZIP.</div>`));
    }

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

// Handle PDF generation after user selects entry HTML
app.post('/generate', express.urlencoded({ extended: true }), async (req, res) => {
    const tempDir = req.body.tempDir;
    const entryHtml = req.body.entryHtml;
    if (!tempDir || !entryHtml) {
        return res.send(htmlTemplate(`<div class="msg error">Missing data for PDF generation.</div>`));
    }

    const entryPath = path.join(tempDir, entryHtml);
    if (!fss.existsSync(entryPath)) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return res.send(htmlTemplate(`<div class="msg error">Selected HTML file not found.</div>`));
    }

    const entryUrl = 'file://' + encodeURI(entryPath);
    const exportPath = path.join(__dirname, 'out', 'Export.pdf');
    if (fss.existsSync(exportPath)) await fs.unlink(exportPath);

    try {
        await generatePdf(entryUrl, { outputDir: path.join(__dirname, 'out') });
        await fs.rm(tempDir, { recursive: true, force: true });
        return res.send(htmlTemplate(`
            <div class="msg">
                <b>PDF generated successfully!</b><br>
                <a href="/download" style="color:#2b6cb0;text-decoration:underline;">Download Export.pdf</a>
            </div>
            <form method="GET" action="/">
                <button type="submit" style="margin-top:18px;">Back</button>
            </form>
        `));
    } catch (err) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return res.send(htmlTemplate(`<div class="msg error"><b>Error:</b> ${err.message}</div>`));
    }
});

// Make sure this is the only place you use res.send for /download:
app.get('/download', (req, res) => {
    const exportPath = path.join(__dirname, 'out', 'Export.pdf');
    if (!fss.existsSync(exportPath)) {
        return res.send(htmlTemplate(`<div class="msg error">No PDF available for download. Please upload and generate first.</div>`));
    }
    res.download(exportPath, 'Export.pdf');
});

app.listen(PORT, () => {
    console.log(`Webapp running at http://localhost:${PORT}`);
});
