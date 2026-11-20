const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

function runExec(cmd, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function docxXmlToText(xml) {
  return decodeXmlEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:br\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<\/w:tr>/gi, '\n')
      .replace(/<\/w:tc>/gi, '  ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocx(tempFile) {
  let xml = '';
  if (process.platform === 'win32') {
    const escaped = tempFile.replace(/'/g, "''");
    const psScript = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${escaped}');`,
      'try {',
      "  $entry = $zip.GetEntry('word/document.xml');",
      '  if (-not $entry) { throw "Missing word/document.xml" }',
      '  $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8);',
      '  try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $reader.ReadToEnd() } finally { $reader.Dispose() }',
      '} finally { $zip.Dispose() }',
    ].join(' ');
    xml = await runExec('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript]);
  } else {
    xml = await runExec('unzip', ['-p', tempFile, 'word/document.xml']);
  }
  const text = docxXmlToText(xml);
  if (!text) throw new Error('The .docx file appears to be empty.');
  return text;
}

async function extractPdf(tempFile) {
  try {
    const out = await runExec('pdftotext', [tempFile, '-']);
    if (out && out.trim()) return out.trim();
  } catch {}

  const pyScript = [
    'import sys',
    'p = sys.argv[1]',
    'text = ""',
    'for mod in ("pypdf", "PyPDF2"):',
    '    try:',
    '        m = __import__(mod)',
    '        r = m.PdfReader(p)',
    '        text = "\\n".join((page.extract_text() or "") for page in r.pages)',
    '        if text.strip(): break',
    '    except Exception: pass',
    'if not text.strip():',
    '    try:',
    '        import fitz',
    '        doc = fitz.open(p)',
    '        text = "\\n".join(page.get_text() for page in doc)',
    '    except Exception: pass',
    'print(text)',
  ].join('\n');

  for (const py of ['python', 'python3']) {
    try {
      const out = await runExec(py, ['-c', pyScript, tempFile]);
      if (out && out.trim()) return out.trim();
    } catch {}
  }

  throw new Error('Could not extract text from PDF. Please convert to .txt, .md, or .docx, or paste the text directly.');
}

async function extractTextFromBuffer(fileName, buffer) {
  const ext = path.extname(String(fileName || '')).toLowerCase();
  if (ext !== '.docx' && ext !== '.pdf') {
    return buffer.toString('utf8');
  }

  const tempFile = path.join(os.tmpdir(), `llm_pilot_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  fs.writeFileSync(tempFile, buffer);
  try {
    if (ext === '.docx') return await extractDocx(tempFile);
    return await extractPdf(tempFile);
  } finally {
    try { fs.unlinkSync(tempFile); } catch {}
  }
}

module.exports = {
  extractTextFromBuffer,
  docxXmlToText,
};
