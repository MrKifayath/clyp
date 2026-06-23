import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export async function POST(request) {
  try {
    const { url } = await request.json();
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Run yt-dlp to get JSON metadata
    const command = `yt-dlp -j --no-warnings "${url}"`;
    const { stdout } = await execAsync(command);
    
    const data = JSON.parse(stdout);
    
    return NextResponse.json({
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration, // in seconds
      uploader: data.uploader,
    });
  } catch (error) {
    console.error('Error fetching video info:', error);
    return NextResponse.json({ error: 'Failed to fetch video information. Ensure the URL is valid.' }, { status: 500 });
  }
}
