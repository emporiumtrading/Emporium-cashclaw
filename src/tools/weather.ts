/**
 * Weather data tool — FREE via Open-Meteo API (no key needed).
 * Gives Melista real weather data for prediction market trades.
 */
import type { Tool } from "./types.js";

const CITIES: Record<string, { lat: number; lon: number }> = {
  "seoul": { lat: 37.5665, lon: 126.978 },
  "tokyo": { lat: 35.6762, lon: 139.6503 },
  "new york": { lat: 40.7128, lon: -74.006 },
  "los angeles": { lat: 34.0522, lon: -118.2437 },
  "london": { lat: 51.5074, lon: -0.1278 },
  "paris": { lat: 48.8566, lon: 2.3522 },
  "berlin": { lat: 52.52, lon: 13.405 },
  "sydney": { lat: -33.8688, lon: 151.2093 },
  "dubai": { lat: 25.2048, lon: 55.2708 },
  "mumbai": { lat: 19.076, lon: 72.8777 },
  "beijing": { lat: 39.9042, lon: 116.4074 },
  "moscow": { lat: 55.7558, lon: 37.6173 },
  "cairo": { lat: 30.0444, lon: 31.2357 },
  "lagos": { lat: 6.5244, lon: 3.3792 },
  "sao paulo": { lat: -23.5505, lon: -46.6333 },
  "mexico city": { lat: 19.4326, lon: -99.1332 },
  "chicago": { lat: 41.8781, lon: -87.6298 },
  "miami": { lat: 25.7617, lon: -80.1918 },
  "singapore": { lat: 1.3521, lon: 103.8198 },
  "hong kong": { lat: 22.3193, lon: 114.1694 },
};

export const getWeather: Tool = {
  definition: {
    name: "get_weather",
    description: "Get current and forecast weather data for any city. Use for prediction market trades about temperature, weather events. FREE — no API key needed. Returns hourly temps, high/low, precipitation, wind.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name (e.g. 'Seoul', 'New York', 'London')" },
        latitude: { type: "number", description: "Latitude (if city not in preset list)" },
        longitude: { type: "number", description: "Longitude (if city not in preset list)" },
      },
      required: ["city"],
    },
  },
  async execute(input) {
    const cityName = (input.city as string).toLowerCase();
    let lat = input.latitude as number | undefined;
    let lon = input.longitude as number | undefined;

    if (!lat || !lon) {
      const preset = CITIES[cityName];
      if (preset) {
        lat = preset.lat;
        lon = preset.lon;
      } else {
        // Try geocoding via Open-Meteo
        try {
          const geoResp = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1`, { signal: AbortSignal.timeout(5000) });
          const geoData = await geoResp.json() as { results?: Array<{ latitude: number; longitude: number; name: string; country: string }> };
          if (geoData.results?.[0]) {
            lat = geoData.results[0].latitude;
            lon = geoData.results[0].longitude;
          }
        } catch { /* fall through */ }
      }
    }

    if (!lat || !lon) {
      return { success: false, data: `City "${cityName}" not found. Try a major city name or provide latitude/longitude.` };
    }

    try {
      const resp = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=2&current=temperature_2m,wind_speed_10m,precipitation`,
        { signal: AbortSignal.timeout(10000) },
      );
      const data = await resp.json() as {
        current?: { temperature_2m: number; wind_speed_10m: number; precipitation: number };
        hourly?: { time: string[]; temperature_2m: number[]; precipitation: number[] };
        daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_sum: number[] };
      };

      const current = data.current;
      const daily = data.daily;
      const hourly = data.hourly;

      const lines: string[] = [];
      lines.push(`## Weather: ${input.city} (${lat}, ${lon})\n`);

      if (current) {
        lines.push(`**Current:** ${current.temperature_2m}°C | Wind: ${current.wind_speed_10m} km/h | Precip: ${current.precipitation} mm`);
      }

      if (daily) {
        lines.push(`**Today:** High ${daily.temperature_2m_max[0]}°C / Low ${daily.temperature_2m_min[0]}°C | Rain: ${daily.precipitation_sum[0]} mm`);
        if (daily.temperature_2m_max[1] !== undefined) {
          lines.push(`**Tomorrow:** High ${daily.temperature_2m_max[1]}°C / Low ${daily.temperature_2m_min[1]}°C | Rain: ${daily.precipitation_sum[1]} mm`);
        }
      }

      if (hourly) {
        lines.push(`\n**Hourly forecast (next 12h):**`);
        const now = new Date();
        const currentHour = now.getHours();
        for (let i = 0; i < Math.min(12, hourly.time.length); i++) {
          const hour = new Date(hourly.time[i]).getHours();
          if (hour >= currentHour || i < 3) {
            lines.push(`  ${hourly.time[i].split("T")[1]}: ${hourly.temperature_2m[i]}°C | Rain: ${hourly.precipitation[i]} mm`);
          }
        }
      }

      lines.push(`\nUse this data for weather prediction market trades.`);
      return { success: true, data: lines.join("\n") };
    } catch (err) {
      return { success: false, data: `Weather API error: ${err instanceof Error ? err.message : err}` };
    }
  },
};
