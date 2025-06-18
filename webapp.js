const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const unzipper = require('unzipper');
const { execFile } = require('child_process');
const os = require('os');
const crypto = require('crypto');
const util = require('util');

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

    // List all extracted files for debugging
    function listFiles(dir, prefix = '') {
        let out = '';
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const relPath = path.relative(tempDir, fullPath);
            if (fs.statSync(fullPath).isDirectory()) {
                out += `${prefix}<b>${relPath}/</b><br>`;
                out += listFiles(fullPath, prefix + '&nbsp;&nbsp;');
            } else {
                out += `${prefix}${relPath}<br>`;
            }
        }
        return out;
    }
    const fileTree = listFiles(tempDir);

    // Clean up uploaded ZIP file (but keep extracted files for now)
    fs.unlinkSync(req.file.path);

    // Show the extracted file tree to the user
    return res.send(htmlTemplate(`
        <h2>Extraction Successful</h2>
        <div class="msg">Extracted files:</div>
        <div style="font-family:monospace; background:#f7fafc; padding:12px; border-radius:6px; margin-top:10px; max-height:300px; overflow:auto;">
            ${fileTree}
        </div>
        <form method="GET" action="/">
            <button type="submit" style="margin-top:18px;">Back</button>
        </form>
        <div class="footer" style="margin-top:24px;">
            <i>Next step: Use this file tree to select the entry HTML file for PDF generation.</i>
        </div>
    `));
});

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

    // List all HTML files for user selection
    const htmlFiles = findHtmlFiles(tempDir, tempDir);

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
        if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath);

        const scriptPath = path.join(__dirname, 'index.js');
        const nodePath = process.execPath;
        const { execFile } = require('child_process');
        execFile(nodePath, [scriptPath, entryUrl], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
            fs.rmSync(tempDir, { recursive: true, force: true });

            if (err) {
                return res.send(htmlTemplate(`<div class="msg error"><b>Error:</b> ${err.message}<br><pre>${stderr}</pre></div>`));
            }
            if (!fs.existsSync(exportPath)) {
                return res.send(htmlTemplate(`<div class="msg error">PDF generation failed.</div>`));
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
        return;
    }

    // Otherwise, show selection UI
    if (htmlFiles.length === 0) {
        fs.rmSync(tempDir, { recursive: true, force: true });
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
app.post('/generate', express.urlencoded({ extended: true }), (req, res) => {
    const tempDir = req.body.tempDir;
    const entryHtml = req.body.entryHtml;
    if (!tempDir || !entryHtml) {
        return res.send(htmlTemplate(`<div class="msg error">Missing data for PDF generation.</div>`));
    }

    const entryPath = path.join(tempDir, entryHtml);
    if (!fs.existsSync(entryPath)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        return res.send(htmlTemplate(`<div class="msg error">Selected HTML file not found.</div>`));
    }

    const entryUrl = 'file://' + encodeURI(entryPath);
    const exportPath = path.join(__dirname, 'out', 'Export.pdf');
    if (fs.existsSync(exportPath)) fs.unlinkSync(exportPath);

    const scriptPath = path.join(__dirname, 'index.js');
    const nodePath = process.execPath;

    const { execFile } = require('child_process');
    execFile(nodePath, [scriptPath, entryUrl], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
        fs.rmSync(tempDir, { recursive: true, force: true });

        if (err) {
            return res.send(htmlTemplate(`<div class="msg error"><b>Error:</b> ${err.message}<br><pre>${stderr}</pre></div>`));
        }
        if (!fs.existsSync(exportPath)) {
            return res.send(htmlTemplate(`<div class="msg error">PDF generation failed.</div>`));
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
});

// Make sure this is the only place you use res.send for /download:
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
