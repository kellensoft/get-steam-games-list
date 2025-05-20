const APP_LIST_URL = "https://api.steampowered.com/ISteamApps/GetAppList/v2/";
const STORE_API_BASE = "https://store.steampowered.com/api/appdetails?appids=";
const RATE_LIMIT_MS = 1100;
const MAX_GAMES = Infinity;

const USER_AGENT = "Mozilla/5.0 (compatible; SteamScraper/1.0)";

// Utility: Retry + timeout wrapper
async function fetchWithRetry(url: string, retries = 1, timeoutMs = 10000): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
        },
      });
      clearTimeout(timeout);
      return response;
    } catch (err) {
      console.warn(`⚠️ Retry ${i + 1} failed for ${url}: ${err}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`❌ Failed to fetch ${url} after ${retries + 1} attempts`);
}

// Load existing progress
let validGames: { appid: number; name: string }[] = [];
try {
  validGames = JSON.parse(await Deno.readTextFile("games.json"));
  console.log(`🔄 Resuming with ${validGames.length} previously saved games.`);
} catch (_) {
  console.log("🆕 Starting fresh.");
}
const seen = new Set(validGames.map((g) => g.appid));

// Get the app list
const response = await fetch(APP_LIST_URL);
const allApps = (await response.json()).applist.apps as { appid: number; name: string }[];

let processed = 0;
for (const app of allApps) {
  if (!app.name?.trim() || seen.has(app.appid)) continue;
  if (processed >= MAX_GAMES) break;

  let storeResp: Response | null = null;
  try {
    storeResp = await fetchWithRetry(`${STORE_API_BASE}${app.appid}`, 1);
  } catch (err) {
    console.warn(`🛑 Failed to fetch store data for ${app.name} (${app.appid}) — applying cooldown...`);
    await new Promise((r) => setTimeout(r, 30000)); // cooldown
    continue;
  }

  const contentType = storeResp.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    console.warn(`⚠️ Non-JSON response for ${app.name} — skipping and pausing`);
    await new Promise((r) => setTimeout(r, 30000)); // cooldown
    continue;
  }

  const storeJson = await storeResp.json();
  const storeData = storeJson?.[app.appid];

  if (storeData?.success && storeData.data?.type === "game") {
    validGames.push({ appid: app.appid, name: app.name });
    seen.add(app.appid);
    console.log(`✅ [${validGames.length}] ${app.name}`);
  } else {
    console.log(`⏩ Skipped: ${app.name}`);
  }

  processed++;
  await Deno.writeTextFile("games.json", JSON.stringify(validGames, null, 2));
  await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
}

console.log(`\n✅ Finished. ${validGames.length} valid games written to games.json`);
