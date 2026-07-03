# YouTube Channel Analytics Chrome Extension

A Chrome extension that overlays real-time analytics directly onto YouTube channel pages — giving creators instant insight into their channel's performance without leaving YouTube.

## Features

- **Live Overlay on Channel Pages** — Injects an analytics panel directly onto any YouTube channel page (`/@handle`, `/channel/ID`, `/c/name`, `/user/name`).
- **Secure Google Sign-In** — Uses Chrome's `identity` API for OAuth 2.0 authentication, so no passwords are stored by the extension.
- **Watch Hours Tracker** — Pulls verified watch-time data (last 365 days) via the YouTube Analytics API for signed-in channel owners.
- **Monetization Eligibility Estimate** — Checks subscriber count against the YouTube Partner Program threshold (1,000 subscribers / 4,000 watch hours) and flags what's publicly verifiable vs. estimated.
- **Niche Detection & RPM Estimate** — Classifies a channel's content niche (Finance, Tech, Education, Health, Gaming, Entertainment, etc.) using keyword analysis and estimates a likely RPM (revenue per 1,000 views) range.
- **Best Upload Time Recommendation** — Analyzes audience activity by day and hour (via YouTube Analytics) to recommend the best day/time to publish new videos, with a pattern-based fallback when verified data isn't available.
- **Similar Channels Discovery** — Surfaces comparable channels in a similar subscriber range for competitive benchmarking.

## Tech Stack

- JavaScript (Vanilla)
- Chrome Extension APIs — `chrome.identity`, `chrome.storage`, `chrome.runtime`
- YouTube Data API v3
- YouTube Analytics API v2
- OAuth 2.0

## Project Structure

```
├── background.js         # Service worker — handles auth, API calls, message routing
├── content.js             # Injected into YouTube pages — builds the analytics overlay UI
├── config.example.js      # Template for API key configuration
├── config.js               # Your local API key (gitignored — never commit this)
└── manifest.json           # Chrome extension manifest
```

## Setup

1. Clone or download this repository.
2. Copy `config.example.js` to `config.js`:
   ```bash
   cp config.example.js config.js
   ```
3. Add your own YouTube Data API v3 key inside `config.js`:
   ```js
   const YT_CONFIG = {
     API_KEY: "YOUR_API_KEY_HERE",
   };
   ```
   Get a key from the [Google Cloud Console](https://console.cloud.google.com/), and restrict it to the YouTube Data API for security.
4. Go to `chrome://extensions` in Chrome.
5. Enable **Developer mode** (top-right toggle).
6. Click **Load unpacked** and select this project folder.
7. Visit any YouTube channel page to see the overlay.

## Permissions & Privacy

- The extension only requests YouTube-related OAuth scopes needed to read the signed-in user's own channel analytics.
- Auth state is stored locally via `chrome.storage.local` and is never sent anywhere outside Google's APIs.
- No user data is collected, stored externally, or shared with third parties.

## Disclaimer

Earnings, RPM, and monetization eligibility figures shown by this extension are **estimates** based on publicly available data and general industry ranges. Actual figures depend on factors (ad rates, audience location, monetization status, etc.) that are not publicly accessible.

## License

This project is for personal/educational use.
