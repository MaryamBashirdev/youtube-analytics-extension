"use strict";

const API_BASE = "https://www.googleapis.com/youtube/v3";
let currentResults = [];
let currentSort = "relevance";

function getApiKey() {
  return typeof YT_CONFIG !== "undefined" ? YT_CONFIG.API_KEY : "";
}

async function apiGet(endpoint, params) {
  const apiKey = getApiKey();
  const url = new URL(`${API_BASE}/${endpoint}`);
  Object.entries({ ...params, key: apiKey }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "API error");
  return data;
}

function formatCompact(n) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function getCompetitionLevel(videoCount) {
  if (videoCount < 50000) return { label: "Low", cls: "comp-low" };
  if (videoCount < 500000) return { label: "Medium", cls: "comp-medium" };
  return { label: "High", cls: "comp-high" };
}

function getCompetitionScore(videoCount) {
  if (videoCount < 50000) return 1;
  if (videoCount < 500000) return 2;
  return 3;
}

async function generateRelatedKeywords(baseKeyword) {
  const prefixes = ["how to", "best", "top", "easy", "beginners"];
  const suffixes = ["tutorial", "tips", "guide", "2024", "for beginners"];
  const related = [];

  // Base keyword itself
  related.push(baseKeyword);

  // Generate variations
  for (const p of prefixes) {
    if (!baseKeyword.toLowerCase().startsWith(p)) {
      related.push(`${p} ${baseKeyword}`);
    }
  }
  for (const s of suffixes) {
    if (!baseKeyword.toLowerCase().endsWith(s)) {
      related.push(`${baseKeyword} ${s}`);
    }
  }

  return [...new Set(related)].slice(0, 8);
}

async function analyzeKeyword(keyword) {
  const data = await apiGet("search", {
    part: "snippet",
    q: keyword,
    type: "video",
    maxResults: "50",
    order: "relevance",
  });

  const totalResults = data.pageInfo?.totalResults || 0;
  const competition = getCompetitionLevel(totalResults);
  const competitionScore = getCompetitionScore(totalResults);

  // Extract related keywords from top video titles
  const titles = (data.items || []).map(item => item.snippet?.title || "").join(" ");
  const words = titles.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !["this", "that", "with", "from", "your", "have", "more", "will", "they", "what", "when", "where", "youtube", "video", "watch", "channel"].includes(w));

  const freq = new Map();
  words.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));

  return {
    keyword,
    totalResults,
    competition,
    competitionScore,
    volumeDisplay: formatCompact(totalResults) + " videos",
  };
}

function sortResults(results, sortBy) {
  const copy = [...results];
  if (sortBy === "competition-low") {
    return copy.sort((a, b) => a.competitionScore - b.competitionScore || a.totalResults - b.totalResults);
  }
  if (sortBy === "competition-high") {
    return copy.sort((a, b) => b.totalResults - a.totalResults);
  }
  return copy; // relevance = original order
}

function renderResults(results) {
  const area = document.getElementById("results-area");
  const sorted = sortResults(results, currentSort);

  if (sorted.length === 0) {
    area.innerHTML = `<div class="state-msg">No results found. Try a different keyword.</div>`;
    return;
  }

  let html = `<div class="results-header"><span class="results-count">${sorted.length} keywords analyzed</span></div>`;

  sorted.forEach(item => {
    html += `
      <div class="keyword-card">
        <div class="keyword-main">
          <div class="keyword-text" title="${item.keyword}">${item.keyword}</div>
          <div class="keyword-meta">
            <span class="comp-pill ${item.competition.cls}">${item.competition.label} competition</span>
            <span class="volume-text">${item.volumeDisplay}</span>
          </div>
        </div>
        <button class="copy-btn" data-keyword="${item.keyword}">Copy</button>
      </div>
    `;
  });

  area.innerHTML = html;

  // Attach copy handlers
  area.querySelectorAll(".copy-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const kw = btn.getAttribute("data-keyword");
      navigator.clipboard.writeText(kw).then(() => {
        btn.textContent = "Copied!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1500);
      });
    });
  });
}

async function runSearch() {
  const input = document.getElementById("keyword-input");
  const btn = document.getElementById("search-btn");
  const area = document.getElementById("results-area");
  const keyword = input.value.trim();

  if (!keyword) return;

  const apiKey = getApiKey();
  if (!apiKey || apiKey === "YOUR_API_KEY_HERE") {
    area.innerHTML = `<div class="error-msg">⚠️ API key missing. Add your YouTube API key to config.js</div>`;
    return;
  }

  btn.disabled = true;
  btn.textContent = "Searching...";
  area.innerHTML = `<div class="state-msg">Analyzing keywords...</div>`;

  try {
    // Generate related keywords
    const keywords = await generateRelatedKeywords(keyword);

    // Analyze each keyword (limit concurrent requests)
    const results = [];
    for (const kw of keywords) {
      try {
        const result = await analyzeKeyword(kw);
        results.push(result);
      } catch (e) {
        // Skip failed keywords
      }
    }

    currentResults = results;
    renderResults(results);

  } catch (err) {
    area.innerHTML = `<div class="error-msg">❌ Error: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Search";
  }
}

// Event listeners
document.getElementById("search-btn").addEventListener("click", runSearch);

document.getElementById("keyword-input").addEventListener("keydown", e => {
  if (e.key === "Enter") runSearch();
});

document.querySelectorAll(".sort-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentSort = btn.getAttribute("data-sort");
    if (currentResults.length > 0) renderResults(currentResults);
  });
});

// Load config.js API key
const script = document.createElement("script");
script.src = chrome.runtime.getURL("config.js");
document.head.appendChild(script);