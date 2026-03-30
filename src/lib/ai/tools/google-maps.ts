import { ToolDefinition, Tool } from './types';

/**
 * Get the Google Maps API key from environment
 */
function getGoogleMapsApiKey(): string {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!apiKey) {
    console.warn('No Google Maps API key found. Set GOOGLE_MAPS_API_KEY or GOOGLE_API_KEY.');
  }
  return apiKey;
}

/**
 * Google Maps Places API - Search for places
 */
const searchPlacesDefinition: ToolDefinition = {
  name: "search_places",
  description: "Search for places using the Google Maps Places API (New). Use this to find places, restaurants, businesses, etc. based on a text query.",
  parameters: {
    type: "OBJECT",
    properties: {
      textQuery: {
        type: "STRING",
        description: "The text query to search for places (e.g., 'pizza near me', 'Eiffel Tower', '123 Main St')."
      },
      maxResultCount: {
        type: "INTEGER",
        description: "The maximum number of results to return (default: 5, max: 20)."
      },
      locationBias: {
        type: "OBJECT",
        description: "Optional. Bias results to a specific location.",
        properties: {
          circle: {
            type: "OBJECT",
            properties: {
              center: {
                type: "OBJECT",
                properties: {
                  latitude: { type: "NUMBER" },
                  longitude: { type: "NUMBER" }
                },
                required: ["latitude", "longitude"]
              },
              radius: { type: "NUMBER", description: "Radius in meters." }
            },
            required: ["center", "radius"]
          }
        }
      }
    },
    required: ["textQuery"]
  }
};

async function executeSearchPlaces(args: any): Promise<any> {
  const apiKey = getGoogleMapsApiKey();
  const url = "https://places.googleapis.com/v1/places:searchText";
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": "places.name,places.formattedAddress,places.displayName,places.priceLevel,places.rating,places.userRatingCount,places.location,places.websiteUri,places.nationalPhoneNumber,places.regularOpeningHours,places.businessStatus"
  };

  const body = {
    textQuery: args.textQuery,
    maxResultCount: args.maxResultCount || 5,
    locationBias: args.locationBias
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `Places API Error: ${response.status} ${response.statusText}`, details: errorText };
    }

    return await response.json();
  } catch (error: any) {
    return { error: `Network error calling Places API: ${error.message}` };
  }
}

/**
 * Google Maps Routes API - Compute routes/directions
 */
const computeRoutesDefinition: ToolDefinition = {
  name: "compute_routes",
  description: "Compute a route between an origin and a destination using the Google Maps Routes API. Call this when the user asks for directions or route information.",
  parameters: {
    type: "OBJECT",
    properties: {
      origin: {
        type: "OBJECT",
        description: "The origin of the route.",
        properties: {
          address: { type: "STRING", description: "Address string or place name." },
          location: {
            type: "OBJECT",
            properties: {
              latLng: {
                type: "OBJECT",
                properties: {
                  latitude: { type: "NUMBER" },
                  longitude: { type: "NUMBER" }
                },
                required: ["latitude", "longitude"]
              }
            }
          }
        }
      },
      destination: {
        type: "OBJECT",
        description: "The destination of the route.",
        properties: {
          address: { type: "STRING", description: "Address string or place name." },
          location: {
            type: "OBJECT",
            properties: {
              latLng: {
                type: "OBJECT",
                properties: {
                  latitude: { type: "NUMBER" },
                  longitude: { type: "NUMBER" }
                },
                required: ["latitude", "longitude"]
              }
            }
          }
        }
      },
      travelMode: {
        type: "STRING",
        description: "The mode of travel.",
        enum: ["DRIVE", "BICYCLE", "WALK", "TWO_WHEELER", "TRANSIT"]
      }
    },
    required: ["origin", "destination"]
  }
};

async function executeComputeRoutes(args: any): Promise<any> {
  const apiKey = getGoogleMapsApiKey();
  const url = "https://routes.googleapis.com/directions/v2:computeRoutes";
  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.description,routes.legs"
  };

  const constructWaypoint = (input: any) => {
    if (input.address) {
      return { address: input.address };
    }
    if (input.location) {
      return { location: input.location };
    }
    return input;
  };

  const body = {
    origin: constructWaypoint(args.origin),
    destination: constructWaypoint(args.destination),
    travelMode: args.travelMode || "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    computeAlternativeRoutes: false,
    routeModifiers: {
      avoidTolls: false,
      avoidHighways: false,
      avoidFerries: false
    },
    languageCode: "en-US",
    units: "IMPERIAL"
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `Routes API Error: ${response.status} ${response.statusText}`, details: errorText };
    }

    return await response.json();
  } catch (error: any) {
    return { error: `Network error calling Routes API: ${error.message}` };
  }
}


/**
 * Shared helper to fetch weather from Google Maps Weather API
 */
async function fetchWeatherFromApi(
  lat: number,
  lng: number,
  apiKey: string,
  type: 'current' | 'hourly' | 'daily' | 'history' = 'current',
  limit?: number
): Promise<any> {
  let endpoint = "currentConditions:lookup";

  switch (type) {
    case 'hourly':
      endpoint = "forecast/hours:lookup";
      break;
    case 'daily':
      endpoint = "forecast/days:lookup";
      break;
    case 'history':
      endpoint = "history/hours:lookup";
      break;
    case 'current':
    default:
      endpoint = "currentConditions:lookup";
      break;
  }

  const baseUrl = `https://weather.googleapis.com/v1/${endpoint}`;

  const params = new URLSearchParams({
    "location.latitude": lat.toString(),
    "location.longitude": lng.toString(),
    "key": apiKey
  });

  // Add limit parameter if provided (controls pageSize for forecasts/history)
  if (limit !== undefined && type !== 'current') {
    params.append("pageSize", limit.toString());
  }

  const url = `${baseUrl}?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Weather API Error (${endpoint}):`, errorText);
    throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Shared helper to fetch air quality from Google Maps Air Quality API
 */
async function fetchAirQualityFromApi(lat: number, lng: number, apiKey: string, dateTime?: string): Promise<any> {
  // Endpoints:
  // Current: https://airquality.googleapis.com/v1/currentConditions:lookup
  // Forecast: https://airquality.googleapis.com/v1/forecast:lookup
  // History: https://airquality.googleapis.com/v1/history:lookup

  // Determine endpoint based on dateTime
  let endpoint = "currentConditions:lookup";
  const now = new Date();

  if (dateTime) {
    const requestDate = new Date(dateTime);
    if (requestDate > now) {
      endpoint = "forecast:lookup";
    } else if (requestDate < now) {
      endpoint = "history:lookup";
    }
  }

  const url = `https://airquality.googleapis.com/v1/${endpoint}?key=${apiKey}`;

  // The Air Quality API uses POST for all lookups with a JSON body
  const body: any = {
    location: {
      latitude: lat,
      longitude: lng
    }
  };

  // Add dateTime if provided (for forecast/history)
  if (dateTime) {
    body.dateTime = dateTime;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Air Quality API Error (${endpoint}):`, errorText);
      throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error(`Air Quality API fetch error:`, error);
    throw error;
  }
}

/**
 * Google Maps Weather API - Get weather by location name
 */
const getWeatherByLocationDefinition: ToolDefinition = {
  name: "get_weather_by_location",
  description: "Get weather information for a specific place. Use 'current' for current conditions, 'forecast_hourly' for hourly forecasts (max 240 hours/10 days ahead), 'forecast_daily' for daily forecasts (max 10 days ahead), or 'history_hourly' for past hourly data (max 24 hours ago). Examples: For tomorrow's weather use type='forecast_daily' with limit=2, for next 6 hours use type='forecast_hourly' with limit=6.",
  parameters: {
    type: "OBJECT",
    properties: {
      location: {
        type: "STRING",
        description: "The name of the place to get weather for."
      },
      type: {
        type: "STRING",
        enum: ["current", "forecast_hourly", "forecast_daily", "history_hourly"],
        description: "Type of weather data: 'current' for now, 'forecast_hourly' for hourly predictions (max 240 hours), 'forecast_daily' for daily predictions (max 10 days, use this for tomorrow/next week), 'history_hourly' for past data (max 24 hours). Default: 'current'."
      },
      limit: {
        type: "NUMBER",
        description: "Number of hours (for hourly) or days (for daily) to return. Examples: limit=24 for next 24 hours, limit=7 for next week's daily forecast, limit=1 for just tomorrow. If omitted, returns default amount (24 hours for hourly, 10 days for daily)."
      }
    },
    required: ["location"]
  }
};

async function executeGetWeatherByLocation(args: any): Promise<any> {
  const apiKey = getGoogleMapsApiKey();
  const locationName = args.location;
  const type = args.type || 'current';
  const limit = args.limit;

  // Map new type names to API endpoints
  let apiType: 'current' | 'hourly' | 'daily' | 'history' = 'current';
  if (type === 'forecast_hourly') apiType = 'hourly';
  else if (type === 'forecast_daily') apiType = 'daily';
  else if (type === 'history_hourly') apiType = 'history';

  // Resolve the location name to coordinates using searchPlaces logic
  const searchResult = await executeSearchPlaces({
    textQuery: locationName,
    maxResultCount: 1
  });

  if (searchResult.error) {
    return { error: `Failed to resolve location '${locationName}': ${searchResult.error}`, details: searchResult.details };
  }

  if (!searchResult.places || searchResult.places.length === 0) {
    return { error: `Could not find any location matching: ${locationName}` };
  }

  const place = searchResult.places[0];
  if (!place.location) {
    return { error: `Location data missing for: ${locationName}` };
  }

  const lat = place.location.latitude;
  const lng = place.location.longitude;
  const resolvedName = place.formattedAddress || place.displayName?.text || locationName;

  try {
    const weatherData = await fetchWeatherFromApi(lat, lng, apiKey, apiType, limit);

    return {
      ...weatherData,
      resolvedLocation: {
        name: resolvedName,
        latitude: lat,
        longitude: lng
      }
    };
  } catch (error: any) {
    return { error: `Network error calling Weather API: ${error.message}` };
  }
}

/**
 * Google Maps Weather API - Get weather by coordinates
 */
const getWeatherByCoordinatesDefinition: ToolDefinition = {
  name: "get_weather_by_coordinates",
  description: "Get weather information for specific coordinates. Use 'current' for current conditions, 'forecast_hourly' for hourly forecasts (max 240 hours/10 days ahead), 'forecast_daily' for daily forecasts (max 10 days ahead), or 'history_hourly' for past hourly data (max 24 hours ago). Examples: For tomorrow's weather use type='forecast_daily' with limit=2, for next 6 hours use type='forecast_hourly' with limit=6.",
  parameters: {
    type: "OBJECT",
    properties: {
      latitude: {
        type: "NUMBER",
        description: "The latitude of the location."
      },
      longitude: {
        type: "NUMBER",
        description: "The longitude of the location."
      },
      type: {
        type: "STRING",
        enum: ["current", "forecast_hourly", "forecast_daily", "history_hourly"],
        description: "Type of weather data: 'current' for now, 'forecast_hourly' for hourly predictions (max 240 hours), 'forecast_daily' for daily predictions (max 10 days, use this for tomorrow/next week), 'history_hourly' for past data (max 24 hours). Default: 'current'."
      },
      limit: {
        type: "NUMBER",
        description: "Number of hours (for hourly) or days (for daily) to return. Examples: limit=24 for next 24 hours, limit=7 for next week's daily forecast, limit=1 for just tomorrow. If omitted, returns default amount (24 hours for hourly, 10 days for daily)."
      }
    },
    required: ["latitude", "longitude"]
  }
};

async function executeGetWeatherByCoordinates(args: any): Promise<any> {
  const apiKey = getGoogleMapsApiKey();
  const lat = args.latitude;
  const lng = args.longitude;
  const type = args.type || 'current';
  const limit = args.limit;

  // Map new type names to API endpoints
  let apiType: 'current' | 'hourly' | 'daily' | 'history' = 'current';
  if (type === 'forecast_hourly') apiType = 'hourly';
  else if (type === 'forecast_daily') apiType = 'daily';
  else if (type === 'history_hourly') apiType = 'history';

  try {
    const weatherData = await fetchWeatherFromApi(lat, lng, apiKey, apiType, limit);

    return {
      ...weatherData,
      resolvedLocation: {
        name: `${lat}, ${lng}`,
        latitude: lat,
        longitude: lng
      }
    };
  } catch (error: any) {
    return { error: `Network error calling Weather API: ${error.message}` };
  }
}


/**
 * Google Maps Air Quality API - Get air quality by location name
 */
const getAirQualityByLocationDefinition: ToolDefinition = {
  name: "get_air_quality_by_location",
  description: "Get air quality (AQI) information for a specific place. Omit 'dates' for current conditions. For forecasts (max 96 hours/4 days ahead), provide future dates. For history (max 30 days ago), provide past dates. Examples: For tomorrow's AQI use dates=['2026-02-03T12:00:00Z'], for next 3 days use dates=['2026-02-03T12:00:00Z', '2026-02-04T12:00:00Z', '2026-02-05T12:00:00Z'].",
  parameters: {
    type: "OBJECT",
    properties: {
      location: {
        type: "STRING",
        description: "The name of the place to get air quality for."
      },
      dates: {
        type: "ARRAY",
        items: {
          type: "STRING"
        },
        description: "Array of ISO 8601 UTC date-time strings (format: 'YYYY-MM-DDTHH:MM:SSZ'). Future dates return forecasts (max 96 hours ahead), past dates return history (max 30 days ago). Example: ['2026-02-03T12:00:00Z'] for Feb 3 noon UTC. Omit for current conditions."
      }
    },
    required: ["location"]
  }
};

async function executeGetAirQualityByLocation(args: any): Promise<any> {
  const apiKey = getGoogleMapsApiKey();
  const locationName = args.location;
  const dates = args.dates || [];

  // Resolve the location name to coordinates using searchPlaces logic
  const searchResult = await executeSearchPlaces({
    textQuery: locationName,
    maxResultCount: 1
  });

  if (searchResult.error) {
    return { error: `Failed to resolve location '${locationName}': ${searchResult.error}`, details: searchResult.details };
  }

  if (!searchResult.places || searchResult.places.length === 0) {
    return { error: `Could not find any location matching: ${locationName}` };
  }

  const place = searchResult.places[0];
  if (!place.location) {
    return { error: `Location data missing for: ${locationName}` };
  }

  const lat = place.location.latitude;
  const lng = place.location.longitude;
  const resolvedName = place.formattedAddress || place.displayName?.text || locationName;

  try {
    // If no dates provided, get current conditions
    if (dates.length === 0) {
      const aqData = await fetchAirQualityFromApi(lat, lng, apiKey);
      return {
        ...aqData,
        resolvedLocation: {
          name: resolvedName,
          latitude: lat,
          longitude: lng
        }
      };
    }

    // If multiple dates, fetch each one
    const results = await Promise.all(
      dates.map(async (dateTime: string) => {
        try {
          const data = await fetchAirQualityFromApi(lat, lng, apiKey, dateTime);
          return {
            dateTime,
            ...data
          };
        } catch (error: any) {
          console.error(`Error fetching air quality for ${dateTime}:`, error);
          return {
            dateTime,
            error: error.message
          };
        }
      })
    );

    return {
      resolvedLocation: {
        name: resolvedName,
        latitude: lat,
        longitude: lng
      },
      results
    };
  } catch (error: any) {
    console.error(`Error in executeGetAirQualityByLocation:`, error);
    return { error: `Network error calling Air Quality API: ${error.message}` };
  }
}

/**
 * Google Maps Air Quality API - Get air quality by coordinates
 */
const getAirQualityByCoordinatesDefinition: ToolDefinition = {
  name: "get_air_quality_by_coordinates",
  description: "Get air quality (AQI) information for specific coordinates. Omit 'dates' for current conditions. For forecasts (max 96 hours/4 days ahead), provide future dates. For history (max 30 days ago), provide past dates. Examples: For tomorrow's AQI use dates=['2026-02-03T12:00:00Z'], for next 3 days use dates=['2026-02-03T12:00:00Z', '2026-02-04T12:00:00Z', '2026-02-05T12:00:00Z'].",
  parameters: {
    type: "OBJECT",
    properties: {
      latitude: {
        type: "NUMBER",
        description: "The latitude of the location."
      },
      longitude: {
        type: "NUMBER",
        description: "The longitude of the location."
      },
      dates: {
        type: "ARRAY",
        items: {
          type: "STRING"
        },
        description: "Array of ISO 8601 UTC date-time strings (format: 'YYYY-MM-DDTHH:MM:SSZ'). Future dates return forecasts (max 96 hours ahead), past dates return history (max 30 days ago). Example: ['2026-02-03T12:00:00Z'] for Feb 3 noon UTC. Omit for current conditions."
      }
    },
    required: ["latitude", "longitude"]
  }
};

async function executeGetAirQualityByCoordinates(args: any): Promise<any> {
  const apiKey = getGoogleMapsApiKey();
  const lat = args.latitude;
  const lng = args.longitude;
  const dates = args.dates || [];

  try {
    // If no dates provided, get current conditions
    if (dates.length === 0) {
      const aqData = await fetchAirQualityFromApi(lat, lng, apiKey);
      return {
        ...aqData,
        resolvedLocation: {
          name: `${lat}, ${lng}`,
          latitude: lat,
          longitude: lng
        }
      };
    }

    // If multiple dates, fetch each one
    const results = await Promise.all(
      dates.map(async (dateTime: string) => {
        try {
          const data = await fetchAirQualityFromApi(lat, lng, apiKey, dateTime);
          return {
            dateTime,
            ...data
          };
        } catch (error: any) {
          console.error(`Error fetching air quality for ${dateTime}:`, error);
          return {
            dateTime,
            error: error.message
          };
        }
      })
    );

    return {
      resolvedLocation: {
        name: `${lat}, ${lng}`,
        latitude: lat,
        longitude: lng
      },
      results
    };
  } catch (error: any) {
    console.error(`Error in executeGetAirQualityByCoordinates:`, error);
    return { error: `Network error calling Air Quality API: ${error.message}` };
  }
}

/**
 * All Google Maps tools
 */
export const googleMapsTools: Tool[] = [
  { definition: searchPlacesDefinition, execute: executeSearchPlaces },
  { definition: computeRoutesDefinition, execute: executeComputeRoutes },
  { definition: getWeatherByLocationDefinition, execute: executeGetWeatherByLocation },
  { definition: getWeatherByCoordinatesDefinition, execute: executeGetWeatherByCoordinates },
  { definition: getAirQualityByLocationDefinition, execute: executeGetAirQualityByLocation },
  { definition: getAirQualityByCoordinatesDefinition, execute: executeGetAirQualityByCoordinates }
];

/**
 * Get all Google Maps tool definitions
 */
export const googleMapsToolDefinitions: ToolDefinition[] = googleMapsTools.map(t => t.definition);

/**
 * Execute a Google Maps tool by name
 */
export async function executeGoogleMapsTool(name: string, args: any): Promise<any> {
  const tool = googleMapsTools.find(t => t.definition.name === name);
  if (!tool) {
    throw new Error(`Unknown Google Maps tool: ${name}`);
  }
  return tool.execute(args);
}
