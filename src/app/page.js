'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [videoInfo, setVideoInfo] = useState(null);
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(null);
  const [error, setError] = useState('');
  
  // Tab State
  const [activeTab, setActiveTab] = useState('manual'); // 'manual' | 'ai'

  // Highlights state
  const [isGeneratingHighlights, setIsGeneratingHighlights] = useState(false);
  const [highlightsStatus, setHighlightsStatus] = useState('');
  const [highlights, setHighlights] = useState([]);
  const [highlightsError, setHighlightsError] = useState('');

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
    setHighlights([]);
    setHighlightsError('');
    setHighlightsStatus('');

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

  const handleGenerateHighlights = async () => {
    if (!url || !apiKey) {
      setHighlightsError('Both YouTube URL and Gemini API Key are required.');
      return;
    }

    setHighlightsError('');
    setIsGeneratingHighlights(true);
    setHighlightsStatus('Initializing...');
    setHighlights([]);

    try {
      const response = await fetch('/api/highlights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, apiKey }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start highlights generation');
      }

      const taskId = data.taskId;

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/highlights?id=${taskId}`);
          if (res.ok) {
            const statusData = await res.json();
            
            if (statusData.status === 'error') {
              clearInterval(pollInterval);
              setHighlightsError(statusData.error || 'Processing failed');
              setIsGeneratingHighlights(false);
              setHighlightsStatus('');
            } else if (statusData.status === 'completed') {
              clearInterval(pollInterval);
              setHighlights(statusData.highlights || []);
              setIsGeneratingHighlights(false);
              setHighlightsStatus('');
            } else if (statusData.step) {
              setHighlightsStatus(statusData.step);
            }
          }
        } catch (err) {
          console.error('Poll failed:', err);
        }
      }, 3000);

    } catch (err) {
      setHighlightsError(err.message);
      setIsGeneratingHighlights(false);
      setHighlightsStatus('');
    }
  };

  const applyTimestamp = (start, end) => {
    const parseTime = (timeStr) => {
      const parts = timeStr.split(':');
      if (parts.length === 3) return parts;
      if (parts.length === 2) return ['00', parts[0], parts[1]];
      return ['00', '00', '00'];
    };

    const [sH, sM, sS] = parseTime(start);
    const [eH, eM, eS] = parseTime(end);

    setStartHr(sH);
    setStartMin(sM);
    setStartSec(sS);

    setEndHr(eH);
    setEndMin(eM);
    setEndSec(eS);
    
    // Switch to manual tab to download
    setActiveTab('manual');
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const handleDownload = async () => {
    if (!url || !videoInfo) return;

    setError('');
    setIsDownloading(true);
    setDownloadProgress(null);

    const taskId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    const start = `${startHr}:${startMin}:${startSec}`;
    const end = `${endHr}:${endMin}:${endSec}`;

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
        <h1 className="title">StreamClipper</h1>
        <p className="subtitle">High-fidelity stream highlighting and extraction.</p>
      </header>

      {error && <div className="error-message">{error}</div>}

      <section className="card glass-panel">
        <h2 className="section-title">Source Media</h2>
        <div className="input-group">
          <label className="input-label">Media URL</label>
          <input
            type="text"
            className="input-field"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <button 
          className="btn btn-primary" 
          onClick={fetchVideoInfo} 
          disabled={isFetchingInfo || !url}
        >
          {isFetchingInfo ? (
            <><div className="spinner"></div> Fetching Metadata...</>
          ) : (
            'Load Source Media'
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
        <div className="workspace">
          <div className="tabs">
            <button 
              className={`tab-btn ${activeTab === 'manual' ? 'active' : ''}`}
              onClick={() => setActiveTab('manual')}
            >
              Manual Extraction
            </button>
            <button 
              className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveTab('ai')}
            >
              Smart Highlights
            </button>
          </div>

          <div className="tab-content glass-panel card">
            {activeTab === 'manual' && (
              <div className="tab-pane fade-in">
                <h2 className="section-title">Define Clip Segment</h2>
                <p className="section-description">Set precise timestamps to extract a high-quality segment.</p>
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

                <div className="input-group" style={{ marginTop: '32px', marginBottom: 0 }}>
                  <button 
                    className="btn btn-primary large-btn" 
                    onClick={handleDownload} 
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <><div className="spinner"></div> Extracting Clip...</>
                    ) : (
                      'Download Full Quality Clip'
                    )}
                  </button>
                  {isDownloading && (
                    <div className="download-status-box">
                      <div className="notice-box">
                        <strong>Background Task:</strong> You can switch tabs, but do not close this window. A save prompt will appear upon completion.
                      </div>
                      <p className="status-text">
                        Processing segment. High-fidelity rendering may take a moment.
                      </p>
                      {downloadProgress && (
                        <div className="progress-grid">
                          <div>Speed: <span>{downloadProgress.speed || 'N/A'}</span></div>
                          <div>Size Processed: <span>{downloadProgress.size || '0 KiB'}</span></div>
                          <div>Duration Copied: <span>{downloadProgress.time || 'N/A'}</span></div>
                          <div>FPS: <span>{downloadProgress.fps || 'N/A'}</span></div>
                          {downloadProgress.frame && (
                            <div className="col-span-2">Frames Extracted: <span>{downloadProgress.frame}</span></div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'ai' && (
              <div className="tab-pane fade-in">
                <h2 className="section-title">Automated Analysis</h2>
                <p className="section-description">
                  Generate timestamps of notable moments. Processing complex streams may take several minutes.
                </p>
                
                <div className="input-group">
                  <label className="input-label">Gemini API Key</label>
                  <input
                    type="password"
                    className="input-field"
                    placeholder="Enter authentication key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>

                {highlightsError && <div className="error-message">{highlightsError}</div>}

                <button 
                  className="btn btn-secondary" 
                  onClick={handleGenerateHighlights} 
                  disabled={isGeneratingHighlights || !url || !apiKey}
                >
                  {isGeneratingHighlights ? (
                    <><div className="spinner"></div> {highlightsStatus || 'Processing...'}</>
                  ) : (
                    'Analyze Media'
                  )}
                </button>

                {highlights.length > 0 && (
                  <div className="highlights-list">
                    <h3 className="highlights-title">Detected Segments</h3>
                    {highlights.map((highlight, index) => (
                      <div key={index} className="highlight-item">
                        <div className="highlight-content">
                          <h4>{highlight.title}</h4>
                          <p>{highlight.description}</p>
                          <span className="timestamp-badge">
                            {highlight.start} - {highlight.end}
                          </span>
                        </div>
                        <button 
                          className="btn-small"
                          onClick={() => applyTimestamp(highlight.start, highlight.end)}
                        >
                          Send to Extractor
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
