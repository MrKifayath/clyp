import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getCookiesFile } from '../../utils/yt-dlp';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID is required' }, { status: 400 });
  }

  const tmpDir = os.tmpdir();
  const progressPath = path.join(tmpDir, `${id}_highlights.json`);

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
    const { url, apiKey } = body;
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }
    
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API Key is required' }, { status: 400 });
    }

    const taskId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const tmpDir = os.tmpdir();
    
    const outputTemplate = path.join(tmpDir, `${taskId}_video.%(ext)s`);
    // yt-dlp will resolve the extension, we need to find what it downloaded
    const progressPath = path.join(tmpDir, `${taskId}_highlights.json`);

    fs.writeFileSync(progressPath, JSON.stringify({ status: 'starting', step: 'Downloading low-res video...' }));

    const cookiesPath = getCookiesFile();
    const args = [
      '-f', 'worst',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
    ];

    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }
    args.push(url);

    console.log(`Executing yt-dlp ${args.join(' ')}`);

    const yt = spawn('yt-dlp', args);

    // Run asynchronously, return the taskId to the client
    yt.on('close', async (code) => {
      if (code !== 0) {
        fs.writeFileSync(progressPath, JSON.stringify({ status: 'error', error: 'Failed to download video' }));
        return;
      }

      const expectedOutputPath = path.join(tmpDir, `${taskId}_video.mp4`);
      
      if (!fs.existsSync(expectedOutputPath)) {
        fs.writeFileSync(progressPath, JSON.stringify({ status: 'error', error: 'Downloaded file not found' }));
        return;
      }

      fs.writeFileSync(progressPath, JSON.stringify({ status: 'processing', step: 'Uploading to Google AI...' }));

      try {
        const fileManager = new GoogleAIFileManager(apiKey);
        const uploadResult = await fileManager.uploadFile(expectedOutputPath, {
          mimeType: "video/mp4",
          displayName: `Livestream_${taskId}`,
        });
        
        let file = await fileManager.getFile(uploadResult.file.name);
        
        fs.writeFileSync(progressPath, JSON.stringify({ status: 'processing', step: 'AI is watching the video...' }));

        while (file.state === FileState.PROCESSING) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          file = await fileManager.getFile(uploadResult.file.name);
        }

        if (file.state === FileState.FAILED) {
          throw new Error("Video processing failed in Gemini API.");
        }

        fs.writeFileSync(progressPath, JSON.stringify({ status: 'processing', step: 'Generating highlights...' }));

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
          Watch this livestream video. Identify the top 5 to 7 most interesting, funny, or hype moments.
          Return ONLY a valid JSON array of objects. Do not include markdown formatting like \`\`\`json.
          Each object must have:
          - "title": A short, punchy title for the moment.
          - "start": The start time in "HH:MM:SS" format.
          - "end": The end time in "HH:MM:SS" format.
          - "description": A brief 1 sentence explanation of what happens.
        `;

        const result = await model.generateContent([
          {
            fileData: {
              mimeType: uploadResult.file.mimeType,
              fileUri: uploadResult.file.uri
            }
          },
          { text: prompt },
        ]);

        let text = result.response.text().trim();
        if (text.startsWith('\`\`\`json')) {
            text = text.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
        }

        const highlights = JSON.parse(text);

        fs.writeFileSync(progressPath, JSON.stringify({ 
          status: 'completed', 
          highlights 
        }));

        // Cleanup
        fs.unlinkSync(expectedOutputPath);
        await fileManager.deleteFile(uploadResult.file.name);

      } catch (err) {
        console.error("AI processing error:", err);
        fs.writeFileSync(progressPath, JSON.stringify({ status: 'error', error: err.message || 'AI processing failed' }));
      }
    });

    return NextResponse.json({ taskId });
  } catch (error) {
    console.error('Error handling highlights request:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
