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
      // Try android client - often works without cookies
      '--extractor-args', 'youtube:player_client=android,mweb',
      '-o', outputTemplate,
    ];

    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
      console.log('Using cookies from:', cookiesPath);
    } else {
      console.log('No cookies - trying Android client');
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

    let errorMessages = [];
    yt.stderr.on('data', (data) => {
      const line = data.toString();
      console.error(`yt-dlp stderr: ${line}`);
      errorMessages.push(line);
      updateProgress(line);
    });

    return new Promise((resolve) => {
      yt.on('close', (code) => {
        // Update status file to finished or error
        if (code !== 0) {
          console.error(`yt-dlp exited with code ${code}`);
          
          // Check for specific error types and provide helpful messages
          const fullError = errorMessages.join(' ');
          let errorMessage = 'Failed to process video segment';
          
          if (fullError.includes('This live event has ended')) {
            errorMessage = 'This video is a recently ended live stream. YouTube may still be processing it. Please try again in a few minutes.';
          } else if (fullError.includes('Video unavailable')) {
            errorMessage = 'Video is unavailable. It may be private, deleted, or region-restricted.';
          } else if (fullError.includes('Sign in to confirm your age')) {
            errorMessage = 'This video requires age verification. Please provide valid YouTube cookies.';
          } else if (fullError.includes('members-only')) {
            errorMessage = 'This video is members-only and requires authentication cookies.';
          }
          
          fs.writeFileSync(progressPath, JSON.stringify({ status: 'error', error: errorMessage }));
          resolve(NextResponse.json({ error: errorMessage }, { status: 500 }));
          return;
        }

        // Check for output file with different extensions
        let actualOutputPath = expectedOutputPath;
        if (!fs.existsSync(expectedOutputPath)) {
          // Try .mp4 if .mkv not found
          const mp4Path = path.join(tmpDir, `${taskId}.mp4`);
          if (fs.existsSync(mp4Path)) {
            actualOutputPath = mp4Path;
            console.log('Found mp4 file instead of mkv:', mp4Path);
          } else {
            console.error('No output file found. Expected:', expectedOutputPath);
            console.error('Also checked:', mp4Path);
            fs.writeFileSync(progressPath, JSON.stringify({ status: 'error', error: 'Processed file not found' }));
            resolve(NextResponse.json({ error: 'Processed file not found' }, { status: 500 }));
            return;
          }
        }

        fs.writeFileSync(progressPath, JSON.stringify({ status: 'completed' }));

        const stat = fs.statSync(actualOutputPath);
        const fileStream = fs.createReadStream(actualOutputPath);

        const stream = new ReadableStream({
          start(controller) {
            fileStream.on('data', (chunk) => controller.enqueue(chunk));
            fileStream.on('end', () => {
              controller.close();
              fs.unlink(actualOutputPath, (err) => {
                 if(err) console.error("Failed to delete temp file:", err);
              });
              fs.unlink(progressPath, () => {});
            });
            fileStream.on('error', (err) => {
              controller.error(err);
              fs.unlink(actualOutputPath, () => {});
              fs.unlink(progressPath, () => {});
            });
          },
          cancel() {
            fileStream.destroy();
            fs.unlink(actualOutputPath, () => {});
            fs.unlink(progressPath, () => {});
          }
        });

        // Use the actual file extension
        const ext = path.extname(actualOutputPath);
        const safeTitle = `clip-${taskId}${ext}`;
        const contentType = ext === '.mp4' ? 'video/mp4' : 'video/x-matroska';
        
        resolve(new NextResponse(stream, {
          headers: {
            'Content-Disposition': `attachment; filename="${safeTitle}"`,
            'Content-Type': contentType,
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

