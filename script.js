// Open-Meteo API endpoints do not require an API key.
// OpenStreetMap search provides wider coverage for Indian districts and local blocks.
const GEO_URL = "https://nominatim.openstreetmap.org/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT = 12000;
const $ = (selector) => document.querySelector(selector);
let activeTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let latestWeatherData;

const weatherCodes = {
  0: ["Clear sky", "clear.svg"], 1: ["Mainly clear", "partly-cloudy.svg"], 2: ["Partly cloudy", "partly-cloudy.svg"],
  3: ["Overcast", "cloudy.svg"], 45: ["Foggy", "fog.svg"], 48: ["Rime fog", "fog.svg"],
  51: ["Light drizzle", "rain.svg"], 53: ["Drizzle", "rain.svg"], 55: ["Heavy drizzle", "rain.svg"],
  56: ["Freezing drizzle", "rain.svg"], 57: ["Heavy freezing drizzle", "rain.svg"], 61: ["Light rain", "rain.svg"],
  63: ["Rain", "rain.svg"], 65: ["Heavy rain", "rain.svg"], 66: ["Freezing rain", "rain.svg"], 67: ["Heavy freezing rain", "rain.svg"],
  71: ["Light snow", "snow.svg"], 73: ["Snow", "snow.svg"], 75: ["Heavy snow", "snow.svg"], 77: ["Snow grains", "snow.svg"],
  80: ["Rain showers", "rain.svg"], 81: ["Rain showers", "rain.svg"], 82: ["Heavy showers", "rain.svg"], 85: ["Snow showers", "snow.svg"], 86: ["Heavy snow showers", "snow.svg"],
  95: ["Thunderstorm", "thunder.svg"], 96: ["Thunderstorm with hail", "thunder.svg"], 99: ["Heavy thunderstorm", "thunder.svg"]
};

function weatherInfo(code) { return weatherCodes[code] || ["Unknown", "cloudy.svg"]; }
function iconElement(code, className = "weather-icon") { const [label, icon] = weatherInfo(code); return `<img class="${className}" src="icons/${icon}" alt="${label}">`; }
// Open-Meteo returns date/time values already adjusted to the requested timezone.
function formatTime(value) { const [hour, minute] = value.slice(11, 16).split(":").map(Number); return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(2000, 0, 1, hour, minute)); }
function formatDay(value) { return new Intl.DateTimeFormat([], { weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
function showError(message) { const error = $("#error-message"); error.textContent = message; error.hidden = false; $("#weather-content").hidden = true; }
function clearError() { $("#error-message").hidden = true; }

// Prevent a stalled connection from leaving the loading indicator on screen.
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The request timed out. Please check your internet connection and try again.");
    throw new Error("Network error. Please check your internet connection and try again.");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function geocodeCity(city) {
  const params = new URLSearchParams({
    q: `${city}, India`, format: "jsonv2", addressdetails: "1", limit: "1", countrycodes: "in", "accept-language": "en"
  });
  const response = await fetchWithTimeout(`${GEO_URL}?${params}`);
  if (!response.ok) throw new Error("Unable to search for that city.");
  const data = await response.json();
  if (!data.length) throw new Error("Location not found. Please check the spelling and try again.");
  const place = data[0];
  return {
    name: place.name || place.display_name.split(",")[0],
    admin1: place.address?.state || place.address?.county || place.address?.district,
    country: "India",
    latitude: Number(place.lat),
    longitude: Number(place.lon)
  };
}

async function fetchWeather({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude, longitude, timezone: "auto",
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,weather_code,surface_pressure,wind_speed_10m",
    hourly: "temperature_2m,weather_code,precipitation_probability,precipitation",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset"
  });
  const response = await fetchWithTimeout(`${WEATHER_URL}?${params}`);
  if (!response.ok) throw new Error("Unable to retrieve weather data right now.");
  return response.json();
}

function renderCurrent(city, data) {
  const current = data.current;
  const [condition, icon] = weatherInfo(current.weather_code);
  $("#location").textContent = [city.name, city.admin1 || city.country].filter(Boolean).join(", ");
  $("#weather-condition").textContent = condition;
  $("#current-icon").src = `icons/${icon}`; $("#current-icon").alt = condition;
  $("#temperature").textContent = `${Math.round(current.temperature_2m)}°`;
  $("#feels-like").textContent = current.apparent_temperature == null ? "—" : `${Math.round(current.apparent_temperature)}°`;
  $("#humidity").textContent = current.relative_humidity_2m == null ? "—" : `${current.relative_humidity_2m}%`;
  $("#wind-speed").textContent = `${Math.round(current.wind_speed_10m)} km/h`;
  $("#pressure").textContent = current.surface_pressure == null ? "—" : `${Math.round(current.surface_pressure)} hPa`;
  $("#sunrise").textContent = formatTime(data.daily.sunrise[0]);
  $("#sunset").textContent = formatTime(data.daily.sunset[0]);
  $("#updated-time").textContent = formatTime(current.time);
}

function renderHourly(data) {
  const now = new Date(data.current.time).getTime();
  const hours = data.hourly.time.map((time, index) => ({ time, index })).filter(({ time }) => new Date(time).getTime() >= now).slice(0, 12);
  $("#hourly-forecast").innerHTML = hours.map(({ time, index }) => `<article class="hour-card"><p class="hour-time">${formatTime(time)}</p>${iconElement(data.hourly.weather_code[index])}<p class="hour-temp">${Math.round(data.hourly.temperature_2m[index])}°</p></article>`).join("");
}

function renderDaily(data) {
  $("#daily-forecast").innerHTML = data.daily.time.slice(0, 7).map((date, index) => `<article class="day-card"><p class="day-name">${index === 0 ? "Today" : formatDay(date)}</p>${iconElement(data.daily.weather_code[index])}<p class="day-range"><strong>${Math.round(data.daily.temperature_2m_max[index])}°</strong><span class="day-low">${Math.round(data.daily.temperature_2m_min[index])}°</span></p></article>`).join("");
}

// Creates a consistent, colour-coded advisory card.
function advisoryCard(icon, title, recommendation, reason, level) {
  return { icon, title, recommendation, reason, level };
}

function getNext24Hours(data) {
  const currentIndex = data.hourly.time.findIndex((time) => time >= data.current.time);
  const start = currentIndex < 0 ? 0 : currentIndex;
  const values = (field) => data.hourly[field].slice(start, start + 24).map((value) => value ?? 0);
  return {
    rainChance: Math.max(...values("precipitation_probability")),
    rainfall: values("precipitation").reduce((total, value) => total + value, 0)
  };
}

function cropAdvice(crop, weather) {
  const rainExpected = weather.rainChance > 60 || weather.rainfall > 5;
  const advice = {
    Rice: rainExpected ? "Rain is beneficial for rice; avoid over-irrigation and monitor standing water." : "Keep paddy soil moist; use light irrigation if fields are drying.",
    Cotton: rainExpected ? "Ensure field drainage; excessive rainfall can harm cotton roots." : "Dry conditions are suitable; irrigate only when soil moisture is low.",
    Wheat: rainExpected ? "Rain should meet water needs today; avoid extra irrigation." : "Dry weather: plan timely irrigation for healthy wheat growth.",
    Soybean: rainExpected ? "Moderate rain supports soybean; postpone field work while soil is wet." : "Conditions are suitable for sowing only if soil moisture is adequate.",
    Maize: rainExpected ? "Avoid waterlogging around maize roots and check drainage." : "Maintain even soil moisture; avoid water stress during growth.",
    Tomato: weather.diseaseRisk ? "High humidity increases tomato fungal risk; improve airflow and inspect leaves." : "Monitor soil moisture and avoid wetting tomato foliage late in the day.",
    Onion: rainExpected ? "Avoid waterlogging; clear drains around onion beds." : "Irrigate lightly only if the topsoil is dry."
  };
  return advice[crop];
}

function renderFarmingAdvisory(data) {
  if (!data) return;
  const { current, daily } = data;
  const next24 = getNext24Hours(data);
  const weather = {
    temperature: current.temperature_2m,
    maxTemperature: daily.temperature_2m_max[0],
    minTemperature: daily.temperature_2m_min[0],
    humidity: current.relative_humidity_2m,
    wind: current.wind_speed_10m,
    rainChance: Math.max(next24.rainChance, daily.precipitation_probability_max[0] ?? 0),
    rainfall: Math.max(next24.rainfall, daily.precipitation_sum[0] ?? 0),
    uv: daily.uv_index_max?.[0]
  };
  weather.diseaseRisk = weather.humidity > 80 && weather.temperature >= 20 && weather.temperature <= 30;
  const rainExpected = weather.rainChance > 60 || weather.rainfall > 5;
  const heavyRain = weather.rainChance > 75 || weather.rainfall > 15;
  const crop = $("#crop-select").value;
  const cards = [];

  if (rainExpected) cards.push(advisoryCard("🌧", "Irrigation", "Do not irrigate today.", `Rain probability is ${Math.round(weather.rainChance)}% with about ${weather.rainfall.toFixed(1)} mm expected.`, "warning"));
  else if (weather.maxTemperature > 35) cards.push(advisoryCard("💧", "Irrigation", "Irrigate early morning or evening.", `The maximum temperature may reach ${Math.round(weather.maxTemperature)}°C.`, "warning"));
  else cards.push(advisoryCard("💧", "Irrigation", "Irrigation is recommended if soil is dry.", "No significant rain is expected in the next 24 hours.", "safe"));

  cards.push(rainExpected ? advisoryCard("🧪", "Fertilizer", "Delay fertilizer application.", "Rain can wash nutrients away before crops absorb them.", "warning") : advisoryCard("🧪", "Fertilizer", "Suitable for fertilizer application.", "Weather is stable with no significant rain expected.", "safe"));
  cards.push(weather.wind > 25 ? advisoryCard("🌬", "Pesticide", "Avoid spraying pesticides.", `Wind speed is ${Math.round(weather.wind)} km/h, which can cause spray drift.`, "danger") : rainExpected ? advisoryCard("🌧", "Pesticide", "Delay pesticide spraying.", "Rain can reduce spray effectiveness and wash chemicals away.", "warning") : advisoryCard("🛡", "Pesticide", "Safe for spraying.", `Wind is calm at ${Math.round(weather.wind)} km/h and rain is unlikely.`, "safe"));
  cards.push(heavyRain ? advisoryCard("🌾", "Harvest", "Delay harvesting.", "Heavy rain is expected and may damage harvested produce.", "danger") : advisoryCard("🌾", "Harvest", "Good day for harvesting.", "No heavy rain is expected today.", "safe"));
  cards.push(weather.temperature > 38 ? advisoryCard("🔴", "Heat stress", "High Heat Stress", "Provide shade, mulch soil, and irrigate during cooler hours.", "danger") : advisoryCard("🌡", "Heat stress", "No high heat stress.", `Current temperature is ${Math.round(weather.temperature)}°C.`, "safe"));
  cards.push(weather.temperature < 10 ? advisoryCard("🔵", "Cold stress", "Cold Stress alert", "Protect sensitive crops with cover and avoid late-evening irrigation.", "warning") : advisoryCard("🌤", "Cold stress", "No cold stress alert.", `Minimum temperature is ${Math.round(weather.minTemperature)}°C.`, "safe"));
  cards.push(weather.diseaseRisk ? advisoryCard("🟠", "Disease risk", "High fungal disease risk.", `Humidity is ${Math.round(weather.humidity)}% at ${Math.round(weather.temperature)}°C; inspect crops and improve airflow.`, "danger") : advisoryCard("🍃", "Disease risk", "Low fungal disease risk.", "Current humidity and temperature are not in the high-risk range.", "safe"));
  cards.push(advisoryCard("🌱", `${crop} guidance`, cropAdvice(crop, weather), weather.uv == null ? "Crop advice is based on rain, temperature, and humidity." : `UV index is ${weather.uv.toFixed(1)}; protect plants from moisture and heat stress.`, rainExpected ? "warning" : "safe"));

  const dangerCount = cards.filter((card) => card.level === "danger").length;
  const warningCount = cards.filter((card) => card.level === "warning").length;
  const status = dangerCount ? ["🔴 Unfavorable Conditions", "danger"] : warningCount ? ["🟡 Moderate Conditions", "warning"] : ["🟢 Excellent for Farming", "safe"];
  $("#farming-status").textContent = status[0];
  $("#farming-status").className = `farming-status status-${status[1]}`;
  $("#advisory-cards").innerHTML = cards.map((card) => `<article class="advisory-card ${card.level}"><h3 class="advisory-title"><span>${card.icon}</span>${card.title}</h3><p class="advisory-recommendation">${card.recommendation}</p><p class="advisory-reason">${card.reason}</p></article>`).join("");
  const mainRisk = cards.find((card) => card.level === "danger")?.title || cards.find((card) => card.level === "warning")?.title || "No major weather risk";
  $("#farming-summary").innerHTML = `<h3 id="summary-title">Today's Farming Summary</h3><ul class="summary-list"><li><strong>✔ Best activity</strong>${cards[3].recommendation}</li><li><strong>✔ Main weather risk</strong>${mainRisk}</li><li><strong>✔ Irrigation</strong>${cards[0].recommendation}</li><li><strong>✔ Harvest</strong>${cards[3].recommendation}</li><li><strong>✔ Disease warning</strong>${cards[6].recommendation}</li></ul>`;
}

async function loadWeather(cityName) {
  clearError();
  try { const city = await geocodeCity(cityName); const weather = await fetchWeather(city); latestWeatherData = weather; activeTimeZone = weather.timezone; updateHeaderClock(); renderCurrent(city, weather); renderFarmingAdvisory(weather); renderHourly(weather); renderDaily(weather); $("#weather-content").hidden = false; }
  catch (error) { showError(error.message || "Something went wrong. Please try again."); }
}

function updateHeaderClock() { $("#local-date-time").textContent = new Intl.DateTimeFormat([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: activeTimeZone }).format(new Date()); }
$("#search-form").addEventListener("submit", (event) => { event.preventDefault(); loadWeather($("#city-input").value.trim()); });
$("#crop-select").addEventListener("change", () => renderFarmingAdvisory(latestWeatherData));
updateHeaderClock(); setInterval(updateHeaderClock, 1000);
loadWeather("New Delhi");
