'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [error, setError] = useState('');

  // Time states
  const [startHr, setStartHr] = useState('00');
  const [startMin, setStartMin] = useState('00');
  const [startSec, setStartSec] = useState('00');

  const [endHr, setEndHr] = useState('00');
  const [endMin, setEndMin] = useState('00');
  const [endSec, setEndSec] = useState('00');

  const fetchVideoInfo = async () => {
    if (!url) {
      setError('Please enter a YouTube URL');
      return;
    }

    setError('');
    setIsFetchingInfo(true);
    setVideoInfo(null);

    try {
      const response = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch video info');
      }

      setVideoInfo(data);
      
      // Pre-fill end time based on video duration
      const totalSeconds = data.duration;
      if (totalSeconds) {
        const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        setEndHr(h);
        setEndMin(m);
        setEndSec(s);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsFetchingInfo(false);
    }
  };

  const handleDownload = async () => {
    if (!url || !videoInfo) return;

    setError('');
    setIsDownloading(true);
    setDownloadProgress(null);

    const taskId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const start = `${startHr}:${startMin}:${startSec}`;
    const end = `${endHr}:${endMin}:${endSec}`;

    // Start polling progress
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/download?id=${taskId}`);
        if (res.ok) {
          const statusData = await res.json();
          if (statusData.progress) {
            setDownloadProgress(statusData.progress);
          }
        }
      } catch (err) {
        console.error('Failed to poll progress:', err);
      }
    }, 1000);

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, start, end, id: taskId }),
      });

      clearInterval(pollInterval);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Download failed');
      }

      // Convert stream to blob
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      const contentDisposition = response.headers.get('content-disposition');
      let filename = 'clip.mkv';
      if (contentDisposition && contentDisposition.indexOf('filename=') !== -1) {
        filename = contentDisposition.split('filename=')[1].replace(/"/g, '');
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      clearInterval(pollInterval);
      setIsDownloading(false);
      setDownloadProgress(null);
    }
  };

  const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <main className="container">
      <header className="header">
        <h1 className="title">YouTube Stream Clip Maker</h1>
        <p className="subtitle">Download specific high-quality sections from long videos or streams</p>
      </header>

      {error && <div className="error-message">{error}</div>}

      <section className="card">
        <div className="input-group">
          <label className="input-label">YouTube URL</label>
          <input
            type="text"
            className="input-field"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <button 
          className="btn" 
          onClick={fetchVideoInfo} 
          disabled={isFetchingInfo || !url}
        >
          {isFetchingInfo ? (
            <><div className="spinner"></div> Fetching Info...</>
          ) : (
            'Load Video'
          )}
        </button>

        {videoInfo && (
          <div className="video-info">
            <div className="thumbnail-wrapper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={videoInfo.thumbnail} alt="Thumbnail" className="thumbnail" />
            </div>
            <div className="video-details">
              <h3 className="video-title" title={videoInfo.title}>{videoInfo.title}</h3>
              <p className="video-meta">{videoInfo.uploader} • {formatDuration(videoInfo.duration)}</p>
            </div>
          </div>
        )}
      </section>

      {videoInfo && (
        <section className="card">
          <div className="time-inputs">
            <div className="time-box">
              <label className="input-label">Start Time</label>
              <div className="time-fields">
                <input type="text" className="input-field time-field" maxLength="2" value={startHr} onChange={e => setStartHr(e.target.value)} placeholder="HH" />
                <span className="time-separator">:</span>
                <input type="text" className="input-field time-field" maxLength="2" value={startMin} onChange={e => setStartMin(e.target.value)} placeholder="MM" />
                <span className="time-separator">:</span>
                <input type="text" className="input-field time-field" maxLength="2" value={startSec} onChange={e => setStartSec(e.target.value)} placeholder="SS" />
              </div>
            </div>

            <div className="time-box">
              <label className="input-label">End Time</label>
              <div className="time-fields">
                <input type="text" className="input-field time-field" maxLength="2" value={endHr} onChange={e => setEndHr(e.target.value)} placeholder="HH" />
                <span className="time-separator">:</span>
                <input type="text" className="input-field time-field" maxLength="2" value={endMin} onChange={e => setEndMin(e.target.value)} placeholder="MM" />
                <span className="time-separator">:</span>
                <input type="text" className="input-field time-field" maxLength="2" value={endSec} onChange={e => setEndSec(e.target.value)} placeholder="SS" />
              </div>
            </div>
          </div>

          <div className="input-group" style={{ marginTop: '30px', marginBottom: 0 }}>
            <button 
              className="btn" 
              onClick={handleDownload} 
              disabled={isDownloading}
              style={{ padding: '18px', fontSize: '1.2rem' }}
            >
              {isDownloading ? (
                <><div className="spinner"></div> Processing & Downloading...</>
              ) : (
                'Download Selection (Full Quality)'
              )}
            </button>
            {isDownloading && (
              <div style={{ marginTop: '20px', padding: '16px', backgroundColor: 'rgba(0, 0, 0, 0.3)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{
                  backgroundColor: 'rgba(241, 31, 66, 0.1)',
                  borderLeft: '4px solid var(--primary)',
                  padding: '12px 16px',
                  borderRadius: '4px',
                  marginBottom: '16px',
                  fontSize: '0.9rem',
                  lineHeight: '1.4',
                  color: 'var(--text-primary)',
                  textAlign: 'left'
                }}>
                  <strong>ℹ️ Notice:</strong> You can switch your tab and continue, but <strong>do not close this tab</strong>. After processing, you will be prompted to choose a save location for this clip.
                </div>
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: downloadProgress ? '12px' : '0' }}>
                  This process relies on yt-dlp. Please wait while the clip is processed. Large high-quality files may take a minute or two.
                </p>
                {downloadProgress && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.95rem' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Speed: <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{downloadProgress.speed || 'N/A'}</span></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Size Processed: <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{downloadProgress.size || '0 KiB'}</span></div>
                    <div style={{ color: 'var(--text-secondary)' }}>Duration Copied: <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{downloadProgress.time || 'N/A'}</span></div>
                    <div style={{ color: 'var(--text-secondary)' }}>FPS: <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>{downloadProgress.fps || 'N/A'}</span></div>
                    {downloadProgress.frame && (
                      <div style={{ color: 'var(--text-secondary)', gridColumn: 'span 2' }}>Frames Extracted: <span style={{ color: 'var(--text-primary)' }}>{downloadProgress.frame}</span></div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
