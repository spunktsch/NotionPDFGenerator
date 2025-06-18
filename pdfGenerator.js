const puppeteer = require('puppeteer');
const fs = require('fs/promises');
const path = require('path');
const PDFMerger = require('pdf-merger-js');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function cleanDir(dir) {
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith('.pdf')) {
        await fs.unlink(path.join(dir, file));
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

async function generate(startUrl, options = {}) {
  const outputDir = options.outputDir || path.join(__dirname, 'out');
  await ensureDir(outputDir);
  await cleanDir(outputDir);

  const browser = await puppeteer.launch({ headless: true });
  const printed = new Map();
  const pdfOrder = [];
  let pdfIndex = 0;

  async function printPdf(url) {
    if (printed.has(url)) {
      console.log('Already visited ' + url + '! Skipping...');
      return;
    }
    console.log('Generating PDF for: ' + url);
    if (pdfIndex >= 1000) return;

    const filename = `${pdfIndex}.pdf`;
    printed.set(url, filename);
    pdfOrder.push(filename);
    pdfIndex++;

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2' });

    const hrefs = await page.$$eval('a', as => as.map(a => a.href));
    for (const href of hrefs) {
      if (href.startsWith('file://') && path.extname(href.split('?')[0].split('#')[0]).toLowerCase() === '.html') {
        if (!printed.has(href)) {
          await printPdf(href);
        }
      }
    }

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      footerTemplate: '<span></span>',
      margin: { top: '20mm', bottom: '20mm' }
    });
    await page.close();
    await fs.writeFile(path.join(outputDir, filename), pdfBuffer);
  }

  async function mergeAll() {
    console.log('Merging PDF');
    const merger = new PDFMerger();
    for (const file of pdfOrder) {
      const filePath = path.join(outputDir, file);
      try {
        await fs.access(filePath);
        await merger.add(filePath);
      } catch (err) {
        console.error('Missing PDF', filePath);
      }
    }
    const exportPath = path.join(outputDir, 'Export.pdf');
    await merger.save(exportPath);
    console.log('PDF Saved at:', exportPath);
    for (const file of pdfOrder) {
      await fs.unlink(path.join(outputDir, file)).catch(() => {});
    }
    return exportPath;
  }

  try {
    await printPdf(startUrl);
    return await mergeAll();
  } finally {
    await browser.close();
  }
}

module.exports = generate;
