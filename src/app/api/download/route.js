import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { getCookiesFile } from '../../utils/yt-dlp';

// Helper to parse progress from ffmpeg/yt-dlp output
function parseProgress(line) {
  // Matches: frame= 1783 fps=101 q=-1.0 size=   17920KiB time=00:00:23.67 bitrate=6200.9kbits/s speed=1.34x
  const frameMatch = line.match(/frame=\s*(\d+)/);
  const fpsMatch = line.match(/fps=\s*([\d.]+)/);
  const sizeMatch = line.match(/size=\s*(\d+[a-zA-Z]+|\d+)/);
  const timeMatch = line.match(/time=\s*([\d:\-.]+)/);
  const speedMatch = line.match(/speed=\s*([\d.x\-]+)/);

  if (frameMatch || sizeMatch || timeMatch) {
    return {
      frame: frameMatch ? frameMatch[1] : null,
      fps: fpsMatch ? fpsMatch[1] : null,
      size: sizeMatch ? sizeMatch[1] : null,
      time: timeMatch ? timeMatch[1] : null,
      speed: speedMatch ? speedMatch[1] : null,
      raw: line.trim()
    };
  }
  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  }

  const tmpDir = os.tmpdir();
  const progressPath = path.join(tmpDir, `${id}.progress`);

  if (!fs.existsSync(progressPath)) {
    return NextResponse.json({ status: 'queued', progress: null });
  }

  try {
    const content = fs.readFileSync(progressPath, 'utf8');
    const data = JSON.parse(content);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ status: 'error', error: 'Failed to read progress' });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { url, start, end, id: clientId } = body;
    
    if (!url || !start || !end) {
      return NextResponse.json({ error: 'URL, start, and end times are required' }, { status: 400 });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const taskId = clientId || id;
    const tmpDir = os.tmpdir();
    const outputTemplate = path.join(tmpDir, `${taskId}.%(ext)s`);
    const expectedOutputPath = path.join(tmpDir, `${taskId}.mkv`);
    const progressPath = path.join(tmpDir, `${taskId}.progress`);

    // Initial progress write
    fs.writeFileSync(progressPath, JSON.stringify({ status: 'starting', progress: null }));

    const cookiesPath = getCookiesFile();
    const args = [
      '--download-sections', `*${start}-${end}`,
      '-f', 'bestvideo+bestaudio/best',
      '--merge-output-format', 'mkv',
      '--concurrent-fragments', '5',
      '-o', outputTemplate,
    ];

    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }
    args.push(url);

    console.log(`Executing yt-dlp ${args.join(' ')}`);

    // Start process
    const yt = spawn('yt-dlp', args);

    // Track latest progress in memory & write asynchronously to disk
    const updateProgress = (logLine) => {
      const parsed = parseProgress(logLine);
      if (parsed) {
        fs.writeFile(progressPath, JSON.stringify({ status: 'downloading', progress: parsed }), () => {});
      }
    };

    yt.stdout.on('data', (data) => {
      const line = data.toString();
      console.log(`yt-dlp stdout: ${line}`);
      updateProgress(line);
    });

    yt.stderr.on('data', (data) => {
      const line = data.toString();
      console.error(`yt-dlp stderr: ${line}`);
      updateProgress(line);
    });

    return new Promise((resolve) => {
      yt.on('close', (code) => {
        // Update status file to finished or error
        if (code !== 0) {
          console.error(`yt-dlp exited with code ${code}`);
          fs.writeFileSync(progressPath, JSON.stringify({ status: 'error', error: 'Failed to process video segment' }));
          resolve(NextResponse.json({ error: 'Failed to process video segment' }, { status: 500 }));
          return;
        }

        if (!fs.existsSync(expectedOutputPath)) {
          fs.writeFileSync(progressPath, JSON.stringify({ status: 'error', error: 'Processed file not found' }));
          resolve(NextResponse.json({ error: 'Processed file not found' }, { status: 500 }));
          return;
        }

        fs.writeFileSync(progressPath, JSON.stringify({ status: 'completed' }));

        const stat = fs.statSync(expectedOutputPath);
        const fileStream = fs.createReadStream(expectedOutputPath);

        const stream = new ReadableStream({
          start(controller) {
            fileStream.on('data', (chunk) => controller.enqueue(chunk));
            fileStream.on('end', () => {
              controller.close();
              fs.unlink(expectedOutputPath, (err) => {
                 if(err) console.error("Failed to delete temp file:", err);
              });
              fs.unlink(progressPath, () => {});
            });
            fileStream.on('error', (err) => {
              controller.error(err);
              fs.unlink(expectedOutputPath, () => {});
              fs.unlink(progressPath, () => {});
            });
          },
          cancel() {
            fileStream.destroy();
            fs.unlink(expectedOutputPath, () => {});
            fs.unlink(progressPath, () => {});
          }
        });

        const safeTitle = `clip-${taskId}.mkv`;
        
        resolve(new NextResponse(stream, {
          headers: {
            'Content-Disposition': `attachment; filename="${safeTitle}"`,
            'Content-Type': 'video/x-matroska',
            'Content-Length': stat.size.toString(),
            'X-Task-ID': taskId
          },
        }));
      });
    });
  } catch (error) {
    console.error('Error handling download:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

