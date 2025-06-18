const path = require('path');
const generatePdf = require('./pdfGenerator');
const { program } = require('commander');

program
  .requiredOption('-u, --url <url>', 'entry HTML file as file:// URL')
  .option('-o, --out-dir <dir>', 'output directory', path.join(__dirname, 'out'));

program.parse(process.argv);
const opts = program.opts();

generatePdf(opts.url, { outputDir: path.resolve(opts.outDir) })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
