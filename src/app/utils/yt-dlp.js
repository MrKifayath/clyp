import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Checks for YT_COOKIES in environment variables.
 * If present, writes them to a temporary file and returns the path.
 * If not present, returns null.
 */
export function getCookiesFile() {
  const cookiesContent = process.env.YT_COOKIES;
  if (!cookiesContent) {
    return null;
  }

  try {
    const tmpDir = os.tmpdir();
    const cookiesPath = path.join(tmpDir, 'yt_cookies.txt');
    // Write cookies content to file (overwriting if exists)
    fs.writeFileSync(cookiesPath, cookiesContent.trim(), 'utf8');
    return cookiesPath;
  } catch (error) {
    console.error('Error writing cookies file:', error);
    return null;
  }
}
