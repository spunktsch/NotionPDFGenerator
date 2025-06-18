const path = require('path');
const { PDFDocument } = require('pdf-lib');

// Accept URL from command line if provided
const url = process.argv[2] || 'file:///Users/basti/code/NotionPDFGenerator/Kuehlung%20-%20index%201fade27b7c0d808b9709e68bc41f4b5a.html';

// Ensure output directory exists
const outputDir = path.join(__dirname, 'out');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Clean output directory before starting
fs.readdirSync(outputDir).forEach(file => {
  if (file.endsWith('.pdf')) {
    fs.unlinkSync(path.join(outputDir, file));
  }
});

// Use a single browser instance
let browser = null;

// Track visited URLs and their assigned index/filename
let printed = new Map();
let pdfOrder = [];

let pdfIndex = 0;
const printPdf = async (url) => {
    if (printed.has(url)) {
        console.log("Already visited " + url + "! Skipping...");
        return;
    }
    console.log('Generating PDF for: ' + url);

    if (pdfIndex >= 1000) { // Increase failsafe for larger sites
        return;
    }

    // Assign a unique filename for this PDF BEFORE recursion
    const filename = `${pdfIndex}.pdf`;
    printed.set(url, filename);
    pdfOrder.push(filename);
    pdfIndex++;

    const page = await browser.newPage();

    await page.setViewport({
        width: 1920,
        height: 1080
    });

    await page.goto(url, {
        waitUntil: 'networkidle2'
    });

    // Recursively process linked HTML files
    const hrefs = await page.$$eval('a', as => as.map(a => a.href));
    for (let href of hrefs) {
        if (href.indexOf("file://") === 0) {
            let extension = path.extname(href.split('?')[0].split('#')[0]).toLowerCase();
            if (extension !== ".html") {
                continue;
            }
            // Only recurse if not already printed
            if (!printed.has(href)) {
                await printPdf(href);
            }
        }
    }

    const pdfFile = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        footerTemplate: "<span></span>",
        margin: { top: "20mm", bottom: "20mm" }
    });

    await page.close();

    writeBufferToFile(pdfFile, filename);
};

function writeBufferToFile(buffer, file) {
    if (!buffer) return;
    try {
        fs.writeFileSync(path.join(outputDir, file), buffer, "binary");
    } catch (err) {
        console.error("Error writing file:", file, err);
    }
}

async function mergeAllPDF() {
    console.log("Merging PDF");
    const mergedPdf = await PDFDocument.create();

    // Use the order in which PDFs were generated
    for (const file of pdfOrder) {
        const filePath = path.join(outputDir, file);
        if (fs.existsSync(filePath)) {
            console.log("Adding " + file + " to merge");
            const pdfBytes = fs.readFileSync(filePath);
            const pdf = await PDFDocument.load(pdfBytes);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }
    }

    const exportPath = path.join(outputDir, 'Export.pdf');
    const pdfBytes = await mergedPdf.save();
    fs.writeFileSync(exportPath, pdfBytes);
    console.log("PDF Saved at:", exportPath);

    console.log("Cleanup started");
    for (const file of pdfOrder) {
        const filePath = path.join(outputDir, file);
        if (fs.existsSync(filePath)) {
            console.log("Deleting " + file + "!");
            fs.unlinkSync(filePath);
        }
    }
}

(async () => {
    browser = await puppeteer.launch({ headless: true });
    try {
        await printPdf(url);
        await mergeAllPDF();
    } catch (err) {
        console.error("Fatal error:", err);
    } finally {
        if (browser) await browser.close();
    }
})();
