(function () {
  "use strict";

  const OVERLAY_ID = "yt-stats-overlay-root";
  const API_BASE = "https://www.googleapis.com/youtube/v3";
  const RECENT_VIDEO_LIMIT = 50;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  // RPM ranges by niche (per 1000 views)
  const NICHE_RPM = {
    finance:      { low: 8,  high: 25, label: "Finance/Business" },
    tech:         { low: 5,  high: 15, label: "Tech" },
    education:    { low: 4,  high: 12, label: "Education" },
    health:       { low: 4,  high: 10, label: "Health/Fitness" },
    gaming:       { low: 2,  high: 6,  label: "Gaming" },
    entertainment:{ low: 1,  high: 5,  label: "Entertainment" },
    default:      { low: 2,  high: 8,  label: "General" },
  };

  const NICHE_KEYWORDS = {
    finance: ["money","finance","invest","stock","crypto","earning","income","profit","business","revenue","trading","wealth","budget","entrepreneur","startup","marketing","sales"],
    tech: ["tech","software","coding","programming","app","ai","computer","gadget","review","tutorial","developer","web","data","cloud","cyber"],
    education: ["learn","education","study","course","skill","knowledge","how to","explain","guide","training","teach","school","university","exam"],
    health: ["health","fitness","workout","diet","nutrition","yoga","gym","weight","exercise","mental","wellness","medical","doctor"],
    gaming: ["gaming","game","gameplay","playthrough","esport","minecraft","fortnite","roblox","ps5","xbox","nintendo","streamer"],
    entertainment: ["vlog","funny","prank","challenge","reaction","music","dance","comedy","celebrity","gossip","drama","entertainment"],
  };  const MONETIZATION_SUBS_REQUIRED = 1000;
  const MONETIZATION_HOURS_REQUIRED = 4000;
  const SIMILAR_CHANNELS_LIMIT = 3;
  const SIMILAR_CHANNELS_SEARCH_MAX = 20;
  const SIMILAR_SUBSCRIBER_MIN_RATIO = 0.2;
  const SIMILAR_SUBSCRIBER_MAX_RATIO = 5;
  const BEST_UPLOAD_TIME_SAMPLE = 15;
  const BEST_UPLOAD_TIME_MIN_VIDEOS = 3;

  const SEO_POWER_WORDS = new Set([
    "best", "top", "how", "why", "what", "watch", "first", "last", "never",
    "always", "secret", "truth", "real", "every", "most", "vs", "review"
  ]);

  const DAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ];

  const KEYWORD_STOP_WORDS = new Set([
    "about", "also", "and", "are", "channel", "for", "from", "have", "https", "into",
    "just", "more", "most", "other", "our", "some", "subscribe", "subscribed", "that",
    "the", "their", "them", "then", "these", "this", "through", "video", "videos",
    "welcome", "what", "when", "where", "which", "with", "would", "www", "you", "your",
    "youtube",
  ]);

  const MONETIZATION_PUBLIC_NOTE =
    "Estimate based on subscriber count only — full eligibility also requires 4,000 watch hours, which isn't public data";
  const EARNINGS_PUBLIC_NOTE =
    "Based on public view data — actual earnings depend on monetization status, ad rates, and audience location, which aren't public";
  const BEST_UPLOAD_TIME_ESTIMATE_NOTE =
    "Based on this channel's own upload pattern, not verified audience activity";

  let activeChannelKey = null;
  let fetchToken = 0;
  let overlayHost = null;
  let overlayValues = null;

  function isChannelPage() {
    const path = location.pathname;
    return (
      /^\/@[^/]+(\/.*)?$/.test(path) ||
      /^\/channel\/[^/]+(\/.*)?$/.test(path) ||
      /^\/c\/[^/]+(\/.*)?$/.test(path) ||
      /^\/user\/[^/]+(\/.*)?$/.test(path)
    );
  }

  function parseChannelFromUrl() {
    const path = location.pathname;
    const handleMatch = path.match(/^\/@([^/]+)/);
    if (handleMatch) return { type: "handle", value: handleMatch[1] };
    const channelMatch = path.match(/^\/channel\/([^/]+)/);
    if (channelMatch) return { type: "id", value: channelMatch[1] };
    const customMatch = path.match(/^\/c\/([^/]+)/);
    if (customMatch) return { type: "custom", value: customMatch[1] };
    const userMatch = path.match(/^\/user\/([^/]+)/);
    if (userMatch) return { type: "user", value: userMatch[1] };
    return null;
  }

  function getChannelKey() {
    const identifier = parseChannelFromUrl();
    if (!identifier) return null;
    return `${identifier.type}:${identifier.value.toLowerCase()}`;
  }

  function getApiKey() {
    return typeof YT_CONFIG !== "undefined" ? YT_CONFIG.API_KEY : "";
  }

  function formatNumber(value) {
    return Number(value).toLocaleString("en-US");
  }

  function formatCompactNumber(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(numeric);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseIsoDurationSeconds(isoDuration) {
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }

  function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  function formatEarningsAmount(amount) {
    const fractionDigits = amount >= 1 ? 0 : 2;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  }

  function detectNiche(channelTitle, channelDescription) {
    const text = (channelTitle + " " + channelDescription).toLowerCase();
    let bestNiche = "default";
    let bestScore = 0;
    for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
      const score = keywords.filter(kw => text.includes(kw)).length;
      if (score > bestScore) { bestScore = score; bestNiche = niche; }
    }
    return { rpm: NICHE_RPM[bestNiche], niche: bestNiche };
  }

  function calculateDollarEarningsEstimate(monthlyViews, rpm) {
    if (!monthlyViews || monthlyViews < 100) return "Not enough data";
    const low = (monthlyViews / 1000) * rpm.low;
    const high = (monthlyViews / 1000) * rpm.high;
    return formatEarningsAmount(low) + " - " + formatEarningsAmount(high) + " / month";
  }

  function resolvePublicEarningsDisplay(values) {
    const { rpm, niche } = detectNiche(values.channelTitle || "", values.channelDescription || "");

    const weeklyUploads = parseFloat(values.uploadFrequency) || 0;
    const monthlyViewsRecent = Number(values.viewsLastThirtyDays) || 0;
    const uploadsLast30 = Number(values.uploadsLastThirtyDays) || 0;

    // If channel is inactive (no uploads recently, frequency is 0),
    // we cannot reliably estimate current earnings — show honest message instead
    const isInactive = weeklyUploads === 0 && uploadsLast30 === 0;

    if (isInactive) {
      return {
        display: "Not enough recent activity to estimate",
        nicheLabel: rpm.label,
        inactive: true,
      };
    }

    let monthlyViews = monthlyViewsRecent;

    // If some recent activity exists but views are very low, use total views / channel age as fallback
    if (monthlyViews < 1000) {
      const totalViews = Number(values.rawViewCount) || 0;
      const totalVideos = Number(values.rawVideoCount) || 1;
      const estimatedMonths = Math.max(6, totalVideos / Math.max(0.1, weeklyUploads * 4));
      monthlyViews = Math.round(totalViews / estimatedMonths);
    }

    return {
      display: calculateDollarEarningsEstimate(monthlyViews, rpm),
      nicheLabel: rpm.label,
      inactive: false,
    };
  }

  function resolveEarningsDisplay(values) {
    if (values.showPrivateStats) {
      const rpm = detectNiche(values.channelTitle || "", values.channelDescription || "").rpm;
      const display = values.monetizationEligible
        ? calculateDollarEarningsEstimate(Number(values.viewsLastThirtyDays) || 0, rpm)
        : "No ad revenue";
      return display;
    }
    const result = resolvePublicEarningsDisplay(values);
    return result.display;
  }

  function getPublicMonetizationEstimate(rawSubscriberCount, subscriberCountHidden, uploadFrequency, uploadsLastThirtyDays) {
    if (subscriberCountHidden) return { status: "Unknown — subscriber count hidden", tone: "neutral" };

    const weeklyUploads = parseFloat(uploadFrequency) || 0;
    const isInactive = weeklyUploads === 0 && (Number(uploadsLastThirtyDays) || 0) === 0;

    if (isInactive) {
      return {
        status: "Unknown — channel inactive, can't verify",
        tone: "neutral",
      };
    }

    if (rawSubscriberCount >= MONETIZATION_SUBS_REQUIRED) return { status: "Likely eligible", tone: "likely-eligible" };
    return { status: "Not eligible — needs more subscribers", tone: "not-eligible" };
  }

  function isFullyMonetized(rawSubscriberCount, subscriberCountHidden, watchHours) {
    const hoursOk = watchHours >= MONETIZATION_HOURS_REQUIRED;
    if (subscriberCountHidden) return hoursOk;
    return rawSubscriberCount >= MONETIZATION_SUBS_REQUIRED && hoursOk;
  }

  function getVerifiedMonetizationStatus(rawSubscriberCount, subscriberCountHidden, watchHours) {
    const monetized = isFullyMonetized(rawSubscriberCount, subscriberCountHidden, watchHours);
    return {
      status: monetized ? "Monetized" : "Not monetized",
      tone: monetized ? "verified-monetized" : "verified-not-monetized",
      eligible: monetized,
    };
  }

  function getVerifiedEarningsDisplay(monetized, viewsLastThirtyDays, uploadsLastThirtyDays) {
    if (!monetized) return "No ad revenue";
    return calculateDollarEarningsEstimate(viewsLastThirtyDays, uploadsLastThirtyDays);
  }

  function formatHour12(hour) {
    const period = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12} ${period}`;
  }

  function calculateUploadTimeEstimate(recentVideos) {
    const sample = recentVideos.slice(0, BEST_UPLOAD_TIME_SAMPLE);
    if (sample.length < BEST_UPLOAD_TIME_MIN_VIDEOS) return null;
    const dayCounts = new Array(7).fill(0);
    const hourCounts = new Array(24).fill(0);
    sample.forEach(({ publishedAt }) => {
      const date = new Date(publishedAt);
      dayCounts[date.getUTCDay()] += 1;
      hourCounts[date.getUTCHours()] += 1;
    });
    const bestDay = dayCounts.indexOf(Math.max(...dayCounts));
    const bestHour = hourCounts.indexOf(Math.max(...hourCounts));
    return {
      dayName: DAY_NAMES[bestDay],
      hourDisplay: formatHour12(bestHour),
      display: `Likely best time: ${DAY_NAMES[bestDay]} around ${formatHour12(bestHour)}`,
      source: "estimate",
      note: BEST_UPLOAD_TIME_ESTIMATE_NOTE,
    };
  }

  // ─── SEO SCORE ───────────────────────────────────────────────────────────────

  function calculateSeoScore(videoDetails) {
    // Always return a score — even if videoDetails is empty, show 0
    const sample = (videoDetails || []).slice(0, 10);

    // If no videos at all, return a zero score instead of null
    if (sample.length === 0) {
      return {
        score: 0,
        label: "No data",
        tone: "seo-poor",
        tips: ["No recent videos found to analyze"],
        noTagsNote: false,
      };
    }

    let totalScore = 0;

    sample.forEach((video) => {
      let videoScore = 0;
      const title = video.snippet?.title || "";
      const description = video.snippet?.description || "";
      const tags = video.snippet?.tags || []; // tags may be empty — that's ok
      const thumbnail = video.snippet?.thumbnails;
      const hasCustomThumb = !!(thumbnail?.maxres || thumbnail?.standard);

      // Title quality (40 points — increased since tags often unavailable)
      if (title.length >= 40 && title.length <= 70) videoScore += 15;
      const titleLower = title.toLowerCase();
      const hasPowerWord = [...SEO_POWER_WORDS].some(word => titleLower.includes(word));
      if (hasPowerWord || /\d/.test(title)) videoScore += 15;
      if (title !== title.toUpperCase()) videoScore += 10;

      // Description quality (40 points)
      if (description.length > 150) videoScore += 15;
      if (description.length > 500) videoScore += 10;
      if (/https?:\/\//.test(description) || /\d+:\d+/.test(description)) videoScore += 10;
      if (description.slice(0, 100).trim().length > 20) videoScore += 5;

      // Tags quality (0 points if not available — noted separately)
      if (tags.length >= 5) videoScore += 10;
      if (tags.length >= 10) videoScore += 10;

      // Thumbnail (20 points)
      if (hasCustomThumb) videoScore += 20;

      totalScore += Math.min(videoScore, 100);
    });

    const score = Math.round(totalScore / sample.length);
    let label, tone, tips = [];

    if (score >= 71) { label = "Excellent"; tone = "seo-excellent"; }
    else if (score >= 41) { label = "Needs improvement"; tone = "seo-fair"; }
    else { label = "Poor"; tone = "seo-poor"; }

    // Generate tips
    const avgTitleLength = sample.reduce((sum, v) => sum + (v.snippet?.title?.length || 0), 0) / sample.length;
    const avgDescLength = sample.reduce((sum, v) => sum + (v.snippet?.description?.length || 0), 0) / sample.length;
    const customThumbCount = sample.filter(v => v.snippet?.thumbnails?.maxres || v.snippet?.thumbnails?.standard).length;
    const hasTags = sample.some(v => (v.snippet?.tags || []).length > 0);

    if (avgTitleLength < 40) tips.push("Write longer, more descriptive titles (40–70 characters)");
    if (avgDescLength < 150) tips.push("Write longer descriptions with links and timestamps");
    if (customThumbCount < sample.length * 0.7) tips.push("Use custom thumbnails on all videos");
    if (!hasTags) tips.push("Add tags to your videos to improve discoverability");

    return {
      score,
      label,
      tone,
      tips: tips.slice(0, 3),
      noTagsNote: !hasTags,
    };
  }

  function buildSeoScoreSection(values) {
    // Always show SEO section — even if seoScore is null, show loading state
    const seoScore = values.seoScore;
    if (!seoScore) {
      return `
        <div class="seo-section">
          <div class="soft-card seo-card">
            <div class="soft-card-header">
              <svg class="soft-card-icon seo-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
              <span class="soft-card-title seo-title">SEO Score</span>
            </div>
            <div class="seo-label seo-poor">Analyzing videos...</div>
          </div>
        </div>
      `;
    }

    const { score, label, tone, tips, noTagsNote } = seoScore;
    let barColor = "#ef4444";
    if (score >= 71) barColor = "#16a34a";
    else if (score >= 41) barColor = "#f59e0b";

    const tipsHtml = tips.length > 0
      ? `<ul class="seo-tips">${tips.map(tip => `<li class="seo-tip">${escapeHtml(tip)}</li>`).join("")}</ul>`
      : "";

    const tagsNote = noTagsNote
      ? `<p class="soft-card-footnote seo-footnote" style="margin-top:4px">⚠️ Tags score is 0 — YouTube doesn't always return tags via public API</p>`
      : "";

    return `
      <div class="seo-section">
        <div class="soft-card seo-card">
          <div class="soft-card-header">
            <svg class="soft-card-icon seo-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <span class="soft-card-title seo-title">SEO Score</span>
            <span class="seo-score-badge" style="background:${barColor}">${score}/100</span>
          </div>
          <div class="seo-bar-track">
            <div class="seo-bar-fill" style="width:${score}%;background:${barColor}"></div>
          </div>
          <div class="seo-label ${tone}">${label}</div>
          ${tipsHtml}
          ${tagsNote}
          <p class="soft-card-footnote seo-footnote">Based on last 10 videos public data</p>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────────

  async function fetchVerifiedBestUploadTime() {
    const result = await sendExtensionMessage("GET_BEST_UPLOAD_TIME");
    return { display: result.display, source: "verified", note: null };
  }

  function buildBestUploadTimeValues(recentVideos, showPrivateStats) {
    if (showPrivateStats) {
      return {
        bestUploadTimeState: "loading",
        bestUploadTimeDisplay: "Loading…",
        bestUploadTimeSource: "verified",
        bestUploadTimeNote: null,
      };
    }
    const estimate = calculateUploadTimeEstimate(recentVideos);
    if (!estimate) {
      return {
        bestUploadTimeState: "unavailable",
        bestUploadTimeDisplay: "Not enough recent uploads",
        bestUploadTimeSource: "estimate",
        bestUploadTimeNote: BEST_UPLOAD_TIME_ESTIMATE_NOTE,
      };
    }
    return {
      bestUploadTimeState: "loaded",
      bestUploadTimeDisplay: estimate.display,
      bestUploadTimeSource: estimate.source,
      bestUploadTimeNote: estimate.note,
    };
  }

  function sendExtensionMessage(action, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...payload }, (response) => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!response?.ok) { reject(new Error(response?.error || "Extension request failed")); return; }
        resolve(response.data);
      });
    });
  }

  function formatWatchHoursDisplay(watchHours) {
    return `${formatNumber(Math.round(watchHours))} hours (last 365 days)`;
  }

  async function apiGet(endpoint, params) {
    const apiKey = getApiKey();
    if (!apiKey || apiKey === "YOUR_API_KEY_HERE") throw new Error("Add your YouTube API key to config.js");
    const url = new URL(`${API_BASE}/${endpoint}`);
    Object.entries({ ...params, key: apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url.toString());
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || `API request failed (${response.status})`);
    return data;
  }

  async function resolveChannelId(identifier) {
    if (identifier.type === "id") return identifier.value;
    if (identifier.type === "handle") {
      const data = await apiGet("channels", { part: "id", forHandle: identifier.value });
      return data.items?.[0]?.id || null;
    }
    if (identifier.type === "user") {
      const data = await apiGet("channels", { part: "id", forUsername: identifier.value });
      return data.items?.[0]?.id || null;
    }
    const searchData = await apiGet("search", { part: "snippet", type: "channel", q: identifier.value, maxResults: "1" });
    return searchData.items?.[0]?.snippet?.channelId || null;
  }

  async function fetchChannelDetails(channelId) {
    const data = await apiGet("channels", { part: "statistics,snippet", id: channelId });
    const channel = data.items?.[0];
    if (!channel?.statistics) throw new Error("Channel statistics not found");
    return {
      stats: channel.statistics,
      title: channel.snippet?.title || "",
      description: channel.snippet?.description || "",
    };
  }

  function extractSearchKeywords(title, description) {
    const descriptionWords = String(description || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !KEYWORD_STOP_WORDS.has(word));
    const frequency = new Map();
    descriptionWords.forEach((word) => frequency.set(word, (frequency.get(word) || 0) + 1));
    const topKeywords = [...frequency.entries()]
      .sort((l, r) => r[1] - l[1] || r[0].length - l[0].length)
      .slice(0, 3)
      .map(([word]) => word);
    return [title.trim(), ...topKeywords.slice(0, 3)].filter(Boolean).join(" ").slice(0, 100);
  }

  function isWithinSubscriberRange(candidateCount, currentCount) {
    if (!Number.isFinite(candidateCount) || !Number.isFinite(currentCount) || currentCount <= 0) return false;
    return candidateCount >= currentCount * SIMILAR_SUBSCRIBER_MIN_RATIO && candidateCount <= currentCount * SIMILAR_SUBSCRIBER_MAX_RATIO;
  }

  function rankSimilarChannels(candidates, currentChannelId, rawSubscriberCount) {
    const filtered = candidates.filter((channel) => channel.id !== currentChannelId);
    const canRank = Number.isFinite(rawSubscriberCount) && rawSubscriberCount > 0;
    if (!canRank) return filtered.slice(0, SIMILAR_CHANNELS_LIMIT);
    const inRange = [], outOfRange = [];
    filtered.forEach((channel) => {
      if (isWithinSubscriberRange(channel.rawSubscriberCount, rawSubscriberCount)) inRange.push(channel);
      else outOfRange.push(channel);
    });
    const byProximity = (l, r) => {
      const ld = Math.abs(Math.log10(l.rawSubscriberCount + 1) - Math.log10(rawSubscriberCount + 1));
      const rd = Math.abs(Math.log10(r.rawSubscriberCount + 1) - Math.log10(rawSubscriberCount + 1));
      return ld - rd || l.searchIndex - r.searchIndex;
    };
    inRange.sort(byProximity);
    return [...inRange, ...outOfRange].slice(0, SIMILAR_CHANNELS_LIMIT);
  }

  async function fetchSimilarChannels(channelId, channelTitle, channelDescription, rawSubscriberCount) {
    const query = extractSearchKeywords(channelTitle, channelDescription);
    if (!query) return [];
    const searchData = await apiGet("search", { part: "snippet", type: "channel", q: query, maxResults: String(SIMILAR_CHANNELS_SEARCH_MAX) });
    const searchItems = (searchData.items || []).filter((item) => item.id?.channelId && item.id.channelId !== channelId);
    if (searchItems.length === 0) return [];
    const channelIds = searchItems.map((item) => item.id.channelId);
    const detailsData = await apiGet("channels", { part: "statistics,snippet", id: channelIds.join(",") });
    const detailsById = new Map((detailsData.items || []).map((item) => [item.id, item]));
    const candidates = searchItems.map((item, searchIndex) => {
      const id = item.id.channelId;
      const details = detailsById.get(id);
      if (!details) return null;
      const stats = details.statistics || {};
      const hiddenSubscriberCount = Boolean(stats.hiddenSubscriberCount);
      const rawCount = hiddenSubscriberCount ? null : Number(stats.subscriberCount || 0);
      return {
        id,
        name: details.snippet?.title || item.snippet?.title || "Unknown channel",
        thumbnailUrl: details.snippet?.thumbnails?.default?.url || item.snippet?.thumbnails?.default?.url || "",
        rawSubscriberCount: rawCount,
        subscriberDisplay: hiddenSubscriberCount ? null : `${formatCompactNumber(rawCount)} subscribers`,
        url: `https://www.youtube.com/channel/${id}`,
        searchIndex,
      };
    }).filter(Boolean);
    return rankSimilarChannels(candidates, channelId, rawSubscriberCount);
  }

  async function fetchRecentVideoIds(channelId) {
    const data = await apiGet("search", { part: "snippet", channelId, order: "date", type: "video", maxResults: String(RECENT_VIDEO_LIMIT) });
    return (data.items || []).map((item) => ({ id: item.id.videoId, publishedAt: item.snippet.publishedAt }));
  }

  async function fetchVideoDetails(videoIds) {
    if (videoIds.length === 0) return [];
    const data = await apiGet("videos", { part: "contentDetails,statistics,snippet", id: videoIds.join(",") });
    return data.items || [];
  }

  function calculateVideoMetrics(recentVideos, videoDetails) {
    const detailsById = new Map(videoDetails.map((video) => [video.id, video]));
    const now = Date.now();
    let totalDurationSeconds = 0, durationCount = 0, viewsLastSevenDays = 0, viewsLastThirtyDays = 0, uploadsLastThirtyDays = 0;

    recentVideos.forEach(({ id, publishedAt }) => {
      const details = detailsById.get(id);
      if (!details) return;
      const publishedMs = new Date(publishedAt).getTime();
      const ageMs = now - publishedMs;
      const viewCount = Number(details.statistics.viewCount || 0);
      const durationSeconds = parseIsoDurationSeconds(details.contentDetails.duration);
      if (durationSeconds > 0) { totalDurationSeconds += durationSeconds; durationCount += 1; }
      if (ageMs <= SEVEN_DAYS_MS) viewsLastSevenDays += viewCount;
      if (ageMs <= THIRTY_DAYS_MS) { uploadsLastThirtyDays += 1; viewsLastThirtyDays += viewCount; }
    });

    return {
      averageVideoLength: durationCount > 0 ? formatDuration(Math.round(totalDurationSeconds / durationCount)) : "—",
      uploadFrequency: uploadsLastThirtyDays > 0 ? `${(uploadsLastThirtyDays / (30 / 7)).toFixed(1)} / week` : "0 / week",
      viewsLastSevenDays: formatNumber(viewsLastSevenDays),
      viewsLastThirtyDays,
      uploadsLastThirtyDays,
    };
  }

  async function fetchChannelData(identifier) {
    const channelId = await resolveChannelId(identifier);
    if (!channelId) throw new Error("Could not resolve channel ID from this URL");
    const [channelDetails, recentVideos] = await Promise.all([fetchChannelDetails(channelId), fetchRecentVideoIds(channelId)]);
    const stats = channelDetails.stats;
    const videoDetails = await fetchVideoDetails(recentVideos.map((video) => video.id));
    const videoMetrics = calculateVideoMetrics(recentVideos, videoDetails);
    const seoScore = calculateSeoScore(videoDetails);

    return {
      channelId,
      channelTitle: channelDetails.title,
      channelDescription: channelDetails.description,
      recentVideos,
      rawSubscriberCount: Number(stats.subscriberCount || 0),
      subscriberCountHidden: Boolean(stats.hiddenSubscriberCount),
      subscriberCount: stats.hiddenSubscriberCount ? "Hidden" : formatNumber(stats.subscriberCount || 0),
      rawViewCount: Number(stats.viewCount || 0),
      rawVideoCount: Number(stats.videoCount || 0),
      totalViews: formatNumber(stats.viewCount || 0),
      videoCount: formatNumber(stats.videoCount || 0),
      ...videoMetrics,
      seoScore,
    };
  }

  async function resolveOwnChannelContext(channelId) {
    const authState = await sendExtensionMessage("GET_AUTH_STATE");
    const showPrivateStats = Boolean(authState.signedIn && authState.ownChannelId && authState.ownChannelId === channelId);
    return { authState, showPrivateStats, showOptionalSignIn: !authState.signedIn };
  }

  async function fetchPrivateStats(rawSubscriberCount, subscriberCountHidden) {
    const { watchHours } = await sendExtensionMessage("GET_WATCH_HOURS");
    const monetization = getVerifiedMonetizationStatus(rawSubscriberCount, subscriberCountHidden, watchHours);
    return {
      watchHoursDisplay: formatWatchHoursDisplay(watchHours),
      monetizationStatus: monetization.status,
      monetizationTone: monetization.tone,
      monetizationEligible: monetization.eligible,
      watchHours,
    };
  }

  function buildPublicStatsOverlay(data) {
    const monetization = getPublicMonetizationEstimate(data.rawSubscriberCount, data.subscriberCountHidden, data.uploadFrequency, data.uploadsLastThirtyDays);
    const { rpm, niche } = detectNiche(data.channelTitle || "", data.channelDescription || "");
    const nicheNote = "Niche detected: " + rpm.label + " (RPM $" + rpm.low + "-$" + rpm.high + ") — actual earnings depend on monetization status, ad rates, and audience location";
    return {
      showPrivateStats: false,
      showOptionalSignIn: true,
      monetizationStatus: monetization.status,
      monetizationTone: monetization.tone,
      monetizationNote: MONETIZATION_PUBLIC_NOTE,
      earningsIsEstimate: true,
      earningsNote: nicheNote,
    };
  }

  function buildVerifiedStatsOverlay(data, privateStats) {
    return {
      showPrivateStats: true,
      showOptionalSignIn: false,
      watchHoursDisplay: privateStats.watchHoursDisplay,
      monetizationStatus: privateStats.monetizationStatus,
      monetizationTone: privateStats.monetizationTone,
      monetizationEligible: privateStats.monetizationEligible,
      monetizationNote: null,
      earningsIsEstimate: false,
      earningsNote: null,
    };
  }

  function findChannelBrowse() {
    return (
      document.querySelector('ytd-browse[page-subtype="channels"]') ||
      document.querySelector('ytd-browse[page-subtype="channel"]') ||
      (isChannelPage() ? document.querySelector("ytd-browse") : null)
    );
  }

  function findChannelHeaderAnchor() {
    const browse = findChannelBrowse();
    if (!browse) return null;
    const header = browse.querySelector("#header");
    if (header) return { element: header, position: "afterend" };
    const headerSelectors = [
      "ytd-page-header-renderer", "ytd-c4-tabbed-header-renderer",
      "ytd-interactive-tabbed-header-renderer", "ytd-carousel-header-renderer", "yt-page-header-view-model",
    ];
    for (const selector of headerSelectors) {
      const element = browse.querySelector(selector);
      if (element) return { element, position: "afterend" };
    }
    const contents = browse.querySelector("#contents");
    if (contents) return { element: contents, position: "beforebegin" };
    return null;
  }

  function resolveMetricDisplay(column, values) {
    if (column.compactFrom) {
      if (column.field === "subscribers" && values.subscriberCountHidden) return values.subscriberCount;
      const raw = values[column.compactFrom];
      if (Number.isFinite(raw)) return formatCompactNumber(raw);
    }
    return column.value;
  }

  function buildStatsBar(values) {
    const columns = [
      { label: "Subscribers", value: values.subscriberCount, field: "subscribers", gradient: "stat-subscribers", compactFrom: "rawSubscriberCount" },
      { label: "Total Views", value: values.totalViews, field: "total-views", gradient: "stat-views", compactFrom: "rawViewCount" },
      { label: "Videos", value: values.videoCount, field: "video-count", gradient: "stat-videos", compactFrom: "rawVideoCount" },
      { label: "Avg. Video Length", value: values.averageVideoLength, field: "avg-length", gradient: "stat-length" },
      { label: "Upload Frequency", value: values.uploadFrequency, field: "upload-frequency", gradient: "stat-frequency" },
    ];
    return `
      <div class="stats-bar">
        ${columns.map((column) => `
          <div class="stat-card ${column.gradient}">
            <div class="stat-label">${column.label}</div>
            <div class="stat-value" data-field="${column.field}">${resolveMetricDisplay(column, values)}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function buildBestUploadTimeSection(values) {
    if (values.bestUploadTimeState === "hidden") return "";
    const badge = values.bestUploadTimeSource === "verified"
      ? `<span class="verified-pill">Real data</span>`
      : values.bestUploadTimeSource === "estimate"
        ? `<span class="estimate-pill">Estimate</span>` : "";
    const footnote = values.bestUploadTimeNote
      ? `<p class="soft-card-footnote upload-time-footnote">${values.bestUploadTimeNote}</p>` : "";
    const displayValue = values.bestUploadTimeState === "loading" ? "Loading…" : escapeHtml(values.bestUploadTimeDisplay || "—");
    return `
      <div class="upload-time-section">
        <div class="soft-card upload-time-card">
          <div class="soft-card-header">
            <svg class="soft-card-icon upload-time-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
            </svg>
            <span class="soft-card-title upload-time-title">Best Upload Time</span>
            ${badge}
          </div>
          <div class="upload-time-value" data-field="best-upload-time">${displayValue}</div>
          ${footnote}
        </div>
      </div>
    `;
  }

  function buildSimilarChannelsSection(values) {
    if (values.similarChannelsState === "hidden") return "";
    const header = `
      <div class="section-header similar-header">
        <div class="section-icon similar-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path fill="#ffffff" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
          </svg>
        </div>
        <span class="section-title">Similar channels</span>
      </div>
    `;
    if (values.similarChannelsState === "loading") {
      return `<div class="similar-section">${header}<p class="similar-loading">Finding similar channels...</p></div>`;
    }
    if (values.similarChannelsState === "error" || values.similarChannelsState === "empty") return "";
    const cards = (values.similarChannels || []).map((channel) => {
      const thumbnail = channel.thumbnailUrl
        ? `<img class="similar-thumb" src="${escapeHtml(channel.thumbnailUrl)}" alt="" width="32" height="32" loading="lazy" />`
        : `<div class="similar-thumb similar-thumb-fallback" aria-hidden="true"></div>`;
      return `
        <a class="similar-card" href="${escapeHtml(channel.url)}" target="_blank" rel="noopener noreferrer">
          ${thumbnail}
          <div class="similar-meta">
            <div class="similar-name">${escapeHtml(channel.name)}</div>
            ${channel.subscriberDisplay ? `<div class="similar-subs">${escapeHtml(channel.subscriberDisplay)}</div>` : ""}
          </div>
        </a>
      `;
    }).join("");
    if (!cards) return "";
    return `<div class="similar-section">${header}<div class="similar-row">${cards}</div></div>`;
  }

  function buildSecondarySection(values) {
    const earningsDisplay = resolveEarningsDisplay(values);
    const estimateBadge = values.earningsIsEstimate ? `<span class="estimate-pill">Estimate</span>` : "";

    let monetizationBody = "";
    if (values.showPrivateStats) {
      monetizationBody = `
        <div class="soft-card-value ${values.monetizationTone}" data-field="monetization">${values.monetizationStatus}</div>
        <div class="soft-card-detail" data-field="watch-hours">${values.watchHoursDisplay}</div>
      `;
    } else {
      monetizationBody = `
        <div class="soft-card-value ${values.monetizationTone}" data-field="monetization">${values.monetizationStatus}</div>
        <p class="soft-card-footnote monetization-footnote">${values.monetizationNote}</p>
      `;
    }

    const earningsFootnote = values.earningsNote ? `<p class="soft-card-footnote earnings-footnote">${values.earningsNote}</p>` : "";

    const optionalSignIn = values.showOptionalSignIn ? `
      <div class="sign-in-footer">
        ${values.signInError ? `<span class="sign-in-error">${values.signInError}</span>` : ""}
        <svg class="google-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        <span>
          This is your channel?
          <button type="button" id="google-sign-in" class="sign-in-link">Sign in</button>
          to see your exact watch hours and monetization status.
        </span>
      </div>
    ` : "";

    return `
      <div class="secondary-section">
        <div class="secondary-row">
          <div class="soft-card monetization-card">
            <div class="soft-card-header">
              <svg class="soft-card-icon monetization-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span class="soft-card-title monetization-title">Monetization</span>
            </div>
            ${monetizationBody}
          </div>
          <div class="soft-card earnings-card">
            <div class="soft-card-header">
              <svg class="soft-card-icon earnings-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z"/>
              </svg>
              <span class="soft-card-title earnings-title">Est. Earnings</span>
              ${estimateBadge}
            </div>
            <div class="earnings-amount" data-field="estimated-earnings">${earningsDisplay}</div>
            ${earningsFootnote}
          </div>
        </div>
        ${buildBestUploadTimeSection(values)}
        ${buildSeoScoreSection(values)}
        ${buildSimilarChannelsSection(values)}
        ${optionalSignIn}
      </div>
    `;
  }

  function getLoadingValues() {
    const loading = "Loading…";
    return {
      subscriberCount: loading, totalViews: loading, videoCount: loading,
      averageVideoLength: loading, uploadFrequency: loading,
      viewsLastSevenDays: loading, viewsLastThirtyDays: 0, uploadsLastThirtyDays: 0,
      monetizationStatus: loading, showPrivateStats: false, showOptionalSignIn: true,
      signInError: null, similarChannelsState: "hidden", similarChannels: [],
      bestUploadTimeState: "loading", bestUploadTimeDisplay: "Loading…",
      bestUploadTimeSource: "estimate", bestUploadTimeNote: null,
      seoScore: null,
    };
  }

  function getErrorValues(message) {
    return {
      subscriberCount: "—", totalViews: "—", videoCount: "—",
      averageVideoLength: "—", uploadFrequency: "—",
      viewsLastSevenDays: "—", viewsLastThirtyDays: 0, uploadsLastThirtyDays: 0,
      monetizationStatus: "—", showPrivateStats: false, showOptionalSignIn: true,
      signInError: null, errorMessage: message,
      similarChannelsState: "hidden", similarChannels: [],
      bestUploadTimeState: "unavailable", bestUploadTimeDisplay: "—",
      bestUploadTimeSource: "estimate", bestUploadTimeNote: null,
      seoScore: null,
    };
  }

  function renderOverlayContent(values) {
    const errorBlock = values.errorMessage ? `<p class="error-message">${values.errorMessage}</p>` : "";
    return `
      <style>
        :host { display: block; width: 100%; margin: 0; padding: 16px 24px; box-sizing: border-box; }
        .card { background: #ffffff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06); font-family: "Roboto","Arial",sans-serif; color: #0f0f0f; width: 100%; box-sizing: border-box; overflow: hidden; }
        .error-message { margin: 0; padding: 10px 16px; background: #fef2f2; color: #991b1b; font-size: 13px; line-height: 1.4; border-bottom: 1px solid #fecaca; }
        .card-header { display: flex; align-items: center; gap: 10px; padding: 16px 16px 12px; }
        .header-icon { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg,#3B82F6,#8B5CF6); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .header-icon svg { display: block; }
        .header-title { font-size: 15px; font-weight: 700; color: #0f0f0f; line-height: 1.3; }
        .stats-bar { display: flex; align-items: stretch; gap: 8px; width: 100%; padding: 0 16px 16px; box-sizing: border-box; }
        .stat-card { flex: 1 1 0; min-width: 0; padding: 12px 10px; border-radius: 8px; text-align: left; }
        .stat-subscribers { background: linear-gradient(135deg,#3B82F6,#1D4ED8); }
        .stat-views { background: linear-gradient(135deg,#8B5CF6,#6D28D9); }
        .stat-videos { background: linear-gradient(135deg,#EC4899,#BE185D); }
        .stat-length { background: linear-gradient(135deg,#14B8A6,#0F766E); }
        .stat-frequency { background: linear-gradient(135deg,#F97316,#C2410C); }
        .stat-label { font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.75); line-height: 1.3; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .stat-value { font-size: 19px; font-weight: 700; color: #ffffff; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .secondary-section { padding: 0 16px 16px; }
        .secondary-row { display: flex; gap: 12px; align-items: stretch; }
        .soft-card { flex: 1 1 0; min-width: 0; border-radius: 8px; padding: 14px 16px; }
        .monetization-card { background: linear-gradient(135deg,#f0fdf4,#dcfce7); }
        .earnings-card { background: linear-gradient(135deg,#fffbeb,#fef3c7); }
        .soft-card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
        .soft-card-icon { flex-shrink: 0; }
        .monetization-icon { color: #16a34a; }
        .earnings-icon { color: #d97706; }
        .soft-card-title { font-size: 13px; font-weight: 700; line-height: 1.3; }
        .monetization-title { color: #166534; }
        .earnings-title { color: #92400e; }
        .estimate-pill { display: inline-block; background: #f59e0b; color: #ffffff; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1.4; }
        .soft-card-value { font-size: 14px; font-weight: 600; line-height: 1.4; color: #0f0f0f; }
        .soft-card-value.likely-eligible,.soft-card-value.verified-monetized { color: #15803d; }
        .soft-card-value.not-eligible,.soft-card-value.verified-not-monetized { color: #b91c1c; }
        .soft-card-value.neutral { color: #374151; }
        .soft-card-detail { margin-top: 4px; font-size: 12px; color: #374151; line-height: 1.4; }
        .earnings-amount { font-size: 20px; font-weight: 700; color: #78350f; line-height: 1.3; }
        .soft-card-footnote { margin: 6px 0 0; font-size: 11px; line-height: 1.45; }
        .monetization-footnote { color: #16a34a; }
        .earnings-footnote { color: #b45309; }
        .upload-time-section { margin-top: 12px; }
        .upload-time-card { background: linear-gradient(135deg,#eff6ff,#dbeafe); }
        .upload-time-icon { color: #2563eb; }
        .upload-time-title { color: #1e40af; }
        .upload-time-value { font-size: 15px; font-weight: 600; color: #1e3a8a; line-height: 1.4; }
        .upload-time-footnote { color: #2563eb; }
        .verified-pill { display: inline-block; background: #16a34a; color: #ffffff; font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; line-height: 1.4; }
        .sign-in-footer { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #d1d5db; font-size: 12px; color: #6b7280; line-height: 1.45; flex-wrap: wrap; }
        .google-icon { flex-shrink: 0; margin-top: 1px; }
        .sign-in-error { display: block; width: 100%; margin-bottom: 4px; color: #b91c1c; }
        .sign-in-link { border: none; background: none; padding: 0; margin: 0; color: #2563eb; font-size: inherit; font-family: inherit; font-weight: 700; cursor: pointer; text-decoration: none; }
        .sign-in-link:hover:not(:disabled) { color: #1d4ed8; text-decoration: underline; }
        .sign-in-link:disabled { opacity: 0.6; cursor: wait; }
        .section-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
        .section-icon { width: 24px; height: 24px; border-radius: 6px; background: linear-gradient(135deg,#6366f1,#8b5cf6); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .section-icon svg { display: block; }
        .section-title { font-size: 13px; font-weight: 700; color: #0f0f0f; line-height: 1.3; }
        .similar-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid #e5e7eb; }
        .similar-loading { margin: 0; font-size: 12px; color: #6b7280; line-height: 1.4; }
        .similar-row { display: flex; gap: 8px; align-items: stretch; }
        .similar-card { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; background: #f9fafb; border: 1px solid #e5e7eb; text-decoration: none; color: inherit; transition: background 0.15s ease, border-color 0.15s ease; }
        .similar-card:hover { background: #f3f4f6; border-color: #d1d5db; }
        .similar-thumb { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: #e5e7eb; }
        .similar-thumb-fallback { background: linear-gradient(135deg,#d1d5db,#9ca3af); }
        .similar-meta { min-width: 0; }
        .similar-name { font-size: 12px; font-weight: 600; color: #111827; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .similar-subs { margin-top: 2px; font-size: 11px; color: #6b7280; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .seo-section { margin-top: 12px; }
        .seo-card { background: linear-gradient(135deg,#f5f3ff,#ede9fe); flex: unset; width: 100%; }
        .seo-icon { color: #7c3aed; }
        .seo-title { color: #4c1d95; }
        .seo-score-badge { display: inline-block; color: #ffffff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
        .seo-bar-track { width: 100%; height: 6px; background: #ddd6fe; border-radius: 999px; margin: 8px 0 6px; overflow: hidden; }
        .seo-bar-fill { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
        .seo-label { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
        .seo-excellent { color: #15803d; }
        .seo-fair { color: #d97706; }
        .seo-poor { color: #b91c1c; }
        .seo-tips { margin: 0 0 6px; padding-left: 16px; }
        .seo-tip { font-size: 11.5px; color: #4c1d95; line-height: 1.5; margin-bottom: 2px; }
        .seo-footnote { color: #7c3aed; }
      </style>

      <div class="card">
        ${errorBlock}
        <div class="card-header">
          <div class="header-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path fill="#ffffff" d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
            </svg>
          </div>
          <span class="header-title">Channel stats</span>
        </div>
        ${buildStatsBar(values)}
        ${buildSecondarySection(values)}
      </div>
    `;
  }

  function attachOverlayListeners() {
    if (!overlayHost?.shadowRoot) return;
    const signInButton = overlayHost.shadowRoot.querySelector("#google-sign-in");
    if (signInButton) signInButton.addEventListener("click", handleSignIn);
  }

  function createOverlay(initialValues) {
    const host = document.createElement("div");
    host.id = OVERLAY_ID;
    overlayHost = host;
    overlayValues = initialValues;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = renderOverlayContent(initialValues);
    attachOverlayListeners();
    return host;
  }

  function updateOverlay(values) {
    if (!overlayHost?.shadowRoot) return;
    overlayValues = values;
    overlayHost.shadowRoot.innerHTML = renderOverlayContent(values);
    attachOverlayListeners();
  }

  async function handleSignIn(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await sendExtensionMessage("SIGN_IN");
      const channelKey = getChannelKey();
      fetchToken += 1;
      const token = fetchToken;
      await loadChannelStats(channelKey, token);
    } catch (error) {
      updateOverlay({ ...overlayValues, showOptionalSignIn: true, signInError: error.message });
      button.disabled = false;
    }
  }

  function removeOverlay() {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    overlayHost = null;
    overlayValues = null;
    activeChannelKey = null;
  }

  function isOverlayCorrectlyPlaced(overlay, anchor, position) {
    if (position === "afterend") return overlay.previousElementSibling === anchor.element;
    return overlay.nextElementSibling === anchor.element;
  }

  async function loadBestUploadTime(channelKey, token, context) {
    try {
      const verified = await fetchVerifiedBestUploadTime();
      if (token !== fetchToken || channelKey !== getChannelKey()) return;
      updateOverlay({ ...overlayValues, bestUploadTimeState: "loaded", bestUploadTimeDisplay: verified.display, bestUploadTimeSource: verified.source, bestUploadTimeNote: verified.note });
    } catch (error) {
      if (token !== fetchToken || channelKey !== getChannelKey()) return;
      const fallback = calculateUploadTimeEstimate(context.recentVideos || []);
      updateOverlay({
        ...overlayValues,
        ...(fallback
          ? { bestUploadTimeState: "loaded", bestUploadTimeDisplay: fallback.display, bestUploadTimeSource: "estimate", bestUploadTimeNote: BEST_UPLOAD_TIME_ESTIMATE_NOTE }
          : { bestUploadTimeState: "unavailable", bestUploadTimeDisplay: "Unable to determine", bestUploadTimeSource: "estimate", bestUploadTimeNote: BEST_UPLOAD_TIME_ESTIMATE_NOTE }),
      });
    }
  }

  async function loadSimilarChannels(channelKey, token, context) {
    try {
      const similarChannels = await fetchSimilarChannels(context.channelId, context.channelTitle, context.channelDescription, context.rawSubscriberCount);
      if (token !== fetchToken || channelKey !== getChannelKey()) return;
      updateOverlay({ ...overlayValues, similarChannelsState: similarChannels.length > 0 ? "loaded" : "empty", similarChannels });
    } catch (error) {
      if (token !== fetchToken || channelKey !== getChannelKey()) return;
      updateOverlay({ ...overlayValues, similarChannelsState: "error", similarChannels: [] });
    }
  }

  async function loadChannelStats(channelKey, token) {
    const identifier = parseChannelFromUrl();
    if (!identifier) return;
    try {
      const data = await fetchChannelData(identifier);
      if (token !== fetchToken || channelKey !== getChannelKey()) return;
      const ownChannelContext = await resolveOwnChannelContext(data.channelId);
      let overlayData = { ...data, signInError: null, similarChannelsState: "loading", similarChannels: [] };

      if (ownChannelContext.showPrivateStats) {
        try {
          const privateStats = await fetchPrivateStats(data.rawSubscriberCount, data.subscriberCountHidden);
          if (token !== fetchToken || channelKey !== getChannelKey()) return;
          overlayData = { ...overlayData, ...buildVerifiedStatsOverlay(data, privateStats) };
        } catch (error) {
          overlayData = { ...overlayData, ...buildPublicStatsOverlay(data), showOptionalSignIn: true, signInError: error.message };
        }
      } else {
        overlayData = { ...overlayData, ...buildPublicStatsOverlay(data), showOptionalSignIn: ownChannelContext.showOptionalSignIn };
      }

      overlayData = { ...overlayData, ...buildBestUploadTimeValues(data.recentVideos, overlayData.showPrivateStats) };
      updateOverlay(overlayData);
      if (overlayData.showPrivateStats) loadBestUploadTime(channelKey, token, overlayData);
      loadSimilarChannels(channelKey, token, overlayData);
    } catch (error) {
      if (token !== fetchToken || channelKey !== getChannelKey()) return;
      updateOverlay(getErrorValues(error.message));
    }
  }

  function insertOverlay() {
    if (!isChannelPage()) { removeOverlay(); return; }
    const anchor = findChannelHeaderAnchor();
    if (!anchor) return;
    const channelKey = getChannelKey();
    const existing = document.getElementById(OVERLAY_ID);
    if (existing && isOverlayCorrectlyPlaced(existing, anchor, anchor.position)) {
      if (channelKey && channelKey !== activeChannelKey) {
        activeChannelKey = channelKey;
        fetchToken += 1;
        const token = fetchToken;
        updateOverlay(getLoadingValues());
        loadChannelStats(channelKey, token);
      }
      return;
    }
    removeOverlay();
    const overlay = createOverlay(getLoadingValues());
    anchor.element.insertAdjacentElement(anchor.position, overlay);
    if (channelKey) {
      activeChannelKey = channelKey;
      fetchToken += 1;
      const token = fetchToken;
      loadChannelStats(channelKey, token);
    }
  }

  let observer = null;
  let insertScheduled = false;

  function scheduleInsert() {
    if (insertScheduled) return;
    insertScheduled = true;
    requestAnimationFrame(() => { insertScheduled = false; insertOverlay(); });
  }

  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(scheduleInsert);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleInsert();
  }

  function onNavigation() { removeOverlay(); scheduleInsert(); }

  window.addEventListener("yt-navigate-finish", onNavigation);
  if (document.body) { startObserver(); }
  else { document.addEventListener("DOMContentLoaded", startObserver); }
})();