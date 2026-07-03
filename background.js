const AUTH_STORAGE_KEY = "ytStatsAuthState";
const ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2/reports";
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!token) {
        reject(new Error("No auth token returned"));
        return;
      }

      resolve(token);
    });
  });
}

function removeCachedAuthToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

async function readAuthState() {
  const result = await chrome.storage.local.get(AUTH_STORAGE_KEY);
  return result[AUTH_STORAGE_KEY] || { signedIn: false, ownChannelId: null };
}

async function writeAuthState(state) {
  await chrome.storage.local.set({ [AUTH_STORAGE_KEY]: state });
}

async function clearAuthState() {
  await chrome.storage.local.remove(AUTH_STORAGE_KEY);
}

function getDateRangeLast365Days() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 365);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

async function fetchWatchHoursMinutes(token) {
  const { startDate, endDate } = getDateRangeLast365Days();
  const url = new URL(ANALYTICS_BASE);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("metrics", "estimatedMinutesWatched");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Analytics request failed (${response.status})`;
    throw new Error(message);
  }

  const minutesWatched = Number(data.rows?.[0]?.[0] || 0);
  return minutesWatched;
}

async function fetchOwnChannelId(token) {
  const url = new URL(`${YOUTUBE_API_BASE}/channels`);
  url.searchParams.set("part", "id");
  url.searchParams.set("mine", "true");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Channel lookup failed (${response.status})`;
    throw new Error(message);
  }

  return data.items?.[0]?.id || null;
}

async function verifySignedIn() {
  try {
    const token = await getAuthToken(false);
    const authState = await readAuthState();

    if (!authState.signedIn) {
      return { signedIn: false, ownChannelId: null };
    }

    await fetchWatchHoursMinutes(token);
    return authState;
  } catch {
    await clearAuthState();
    return { signedIn: false, ownChannelId: null };
  }
}

async function signIn() {
  const token = await getAuthToken(true);
  await fetchWatchHoursMinutes(token);

  const ownChannelId = await fetchOwnChannelId(token);
  if (!ownChannelId) {
    throw new Error("Could not determine your YouTube channel");
  }

  const authState = {
    signedIn: true,
    ownChannelId,
  };

  await writeAuthState(authState);
  return authState;
}

async function signOut() {
  try {
    const token = await getAuthToken(false);
    if (token) {
      await removeCachedAuthToken(token);
    }
  } catch {
    // Ignore missing token during sign-out.
  }

  await clearAuthState();
  return { signedIn: false, ownChannelId: null };
}

async function getWatchHours() {
  const authState = await readAuthState();
  if (!authState.signedIn) {
    throw new Error("Not signed in");
  }

  const token = await getAuthToken(false);
  const minutesWatched = await fetchWatchHoursMinutes(token);

  return {
    minutesWatched,
    watchHours: minutesWatched / 60,
  };
}

const ANALYTICS_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatAnalyticsHour(hour) {
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12} ${period}`;
}

function getDateRangeLast90Days() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

async function fetchAudienceActivityByDayHour(token) {
  const { startDate, endDate } = getDateRangeLast90Days();
  const url = new URL(ANALYTICS_BASE);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("metrics", "views");
  url.searchParams.set("dimensions", "day,hour");
  url.searchParams.set("maxResults", "500");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.error?.message || `Analytics request failed (${response.status})`;
    throw new Error(message);
  }

  const rows = data.rows || [];
  if (rows.length === 0) {
    throw new Error("No audience activity data available");
  }

  let bestRow = rows[0];
  let bestViews = Number(rows[0][2] || 0);

  rows.forEach((row) => {
    const views = Number(row[2] || 0);
    if (views > bestViews) {
      bestViews = views;
      bestRow = row;
    }
  });

  const dayIndex = Number(bestRow[0]);
  const hour = Number(bestRow[1]);

  if (!Number.isFinite(dayIndex) || !Number.isFinite(hour) || bestViews <= 0) {
    throw new Error("No audience activity data available");
  }

  return {
    dayName: ANALYTICS_DAY_NAMES[dayIndex] || "Unknown",
    hourDisplay: formatAnalyticsHour(hour),
    views: bestViews,
  };
}

async function getBestUploadTime() {
  const authState = await readAuthState();
  if (!authState.signedIn) {
    throw new Error("Not signed in");
  }

  const token = await getAuthToken(false);
  const activity = await fetchAudienceActivityByDayHour(token);

  return {
    dayName: activity.dayName,
    hourDisplay: activity.hourDisplay,
    display: `Best time to post: ${activity.dayName} at ${activity.hourDisplay}`,
    source: "verified",
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handle = async () => {
    switch (message.action) {
      case "GET_AUTH_STATE":
        return verifySignedIn();

      case "SIGN_IN":
        return signIn();

      case "SIGN_OUT":
        return signOut();

      case "GET_WATCH_HOURS":
        return getWatchHours();

      case "GET_BEST_UPLOAD_TIME":
        return getBestUploadTime();

      default:
        throw new Error(`Unknown action: ${message.action}`);
    }
  };

  handle()
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
