# How to Export Non-Rotating YouTube Cookies

## The Problem
YouTube rotates cookies immediately after you use them in the browser. That's why your cookies work once then fail.

## The Solution (from YouTube's guide)

### Step 1: Use Incognito/Private Window

1. **Open a NEW incognito/private browsing window**
2. **Log into YouTube** in that window
3. **In the SAME tab**, navigate to: `https://www.youtube.com/robots.txt`
4. **Export cookies** using a browser extension (see step 2)
5. **CLOSE the incognito window immediately** - never open it again!

### Step 2: Export Cookies Using Extension

**Install one of these extensions:**
- Chrome: "Get cookies.txt LOCALLY" 
- Firefox: "cookies.txt"

**Export from the incognito tab:**
1. Click extension icon
2. Click "Export" or "Export As"
3. Save as `cookies.txt`

### Step 3: Update Render Environment

1. Go to Render Dashboard → Your Service → Environment
2. Find `YT_COOKIES` variable
3. Paste the ENTIRE content of `cookies.txt`
4. Save (triggers redeploy)

---

## Alternative: Use --cookies-from-browser (Simpler)

Instead of manually exporting, you can have yt-dlp extract cookies directly from your browser.

**This requires modifying how you run yt-dlp:**

```javascript
// Instead of using a cookie file, use --cookies-from-browser
const args = [
  '--cookies-from-browser', 'chrome',  // or 'firefox', 'edge'
  '--download-sections', `*${start}-${end}`,
  '-f', 'bestvideo+bestaudio/best',
  '--merge-output-format', 'mkv',
  '-o', outputTemplate,
  url
];
```

**But this won't work on Render** because your browser isn't on the server.

---

## The Real Issue

Your server IP is getting flagged by YouTube. Even with fresh cookies, you might hit rate limits or bot detection.

## Better Solutions

### Option 1: Use mweb client with PO Token (Recommended by YouTube)

According to the guide you shared, YouTube now prefers PO Tokens over cookies.

See: https://github.com/yt-dlp/yt-dlp/wiki/Extractors#po-token-guide

### Option 2: Try without cookies for public videos

Remove cookies and try downloading public, non-age-restricted videos:

```javascript
const args = [
  '--download-sections', `*${start}-${end}`,
  '-f', 'bestvideo+bestaudio/best',
  '--merge-output-format', 'mkv',
  '--extractor-args', 'youtube:player_client=android',
  '-o', outputTemplate,
  url
];
```

### Option 3: Use visitor data instead of cookies

```javascript
const args = [
  '--extractor-args', 'youtubetab:skip=webpage',
  '--extractor-args', 'youtube:player_skip=webpage,configs;visitor_data=YOUR_VISITOR_DATA',
  '--download-sections', `*${start}-${end}`,
  '-f', 'bestvideo+bestaudio/best',
  '--merge-output-format', 'mkv',
  '-o', outputTemplate,
  url
];
```

---

## Quick Test

Try downloading WITHOUT any cookies first:

1. Remove `YT_COOKIES` from Render environment
2. Redeploy
3. Try a public video

If it works, you don't need cookies for most videos.
