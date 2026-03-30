
import { googleMapsTools } from '../src/lib/ai/tools/google-maps';
import { test, expect } from '@playwright/test';
import { loadTestEnv } from './test-utils';

loadTestEnv();

test.describe('Weather Tool Tests', () => {
  const getTool = (name: string) => googleMapsTools.find(
    (t) => t.definition.name === name
  );

  // Test 1: get_weather_by_location (Current)
  test('get_weather_by_location (current) should return data for a known city', async () => {
    const tool = getTool('get_weather_by_location');
    expect(tool).toBeDefined();

    const result = await tool?.execute({ location: 'San Francisco', type: 'current' });

    expect(result).not.toHaveProperty('error');
    // For 'current', we expect 'currentConditions' usually, 
    // but the exact structure depends on the API response.
    // We check resolvedLocation and generally that we got data back.
    expect(result).toHaveProperty('resolvedLocation');
    expect(result.resolvedLocation.name).toContain('San Francisco');
  });

  // Test 2: get_weather_by_location (Hourly)
  test('get_weather_by_location (hourly) should return hourly forecast', async () => {
    const tool = getTool('get_weather_by_location');

    const result = await tool?.execute({ location: 'London', type: 'forecast_hourly' });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('resolvedLocation');
    // Hourly forecast endpoint returns 'forecastHours' array
    expect(result).toHaveProperty('forecastHours');
    expect(Array.isArray(result.forecastHours)).toBe(true);
  });

  // Test 3: get_weather_by_location (Daily)
  test('get_weather_by_location (daily) should return daily forecast', async () => {
    const tool = getTool('get_weather_by_location');

    const result = await tool?.execute({ location: 'New York', type: 'forecast_daily' });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('resolvedLocation');
    // Daily forecast endpoint returns 'forecastDays' array
    expect(result).toHaveProperty('forecastDays');
    expect(Array.isArray(result.forecastDays)).toBe(true);
  });

  // Test 4: get_weather_by_coordinates (History)
  test('get_weather_by_coordinates (history) should return history data', async () => {
    const tool = getTool('get_weather_by_coordinates');
    expect(tool).toBeDefined();

    // Use SF coordinates
    const lat = 37.7749;
    const lng = -122.4194;
    const result = await tool?.execute({ latitude: lat, longitude: lng, type: 'history_hourly' });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('resolvedLocation');
    // History endpoint returns 'historyHours' array
    expect(result).toHaveProperty('historyHours');
    expect(Array.isArray(result.historyHours)).toBe(true);
  });

  // Test 5: get_weather_by_location with limit (hourly)
  test('get_weather_by_location (hourly with limit) should return limited results', async () => {
    const tool = getTool('get_weather_by_location');

    const result = await tool?.execute({ location: 'San Francisco', type: 'forecast_hourly', limit: 5 });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('resolvedLocation');
    expect(result).toHaveProperty('forecastHours');
    expect(Array.isArray(result.forecastHours)).toBe(true);
    // Should return at most 5 hours
    expect(result.forecastHours.length).toBeLessThanOrEqual(5);
  });

  // Test 6: get_weather_by_coordinates with limit (daily)
  test('get_weather_by_coordinates (daily with limit) should return limited results', async () => {
    const tool = getTool('get_weather_by_coordinates');

    const lat = 51.5074; // London
    const lng = -0.1278;
    const result = await tool?.execute({ latitude: lat, longitude: lng, type: 'forecast_daily', limit: 3 });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('resolvedLocation');
    expect(result).toHaveProperty('forecastDays');
    expect(Array.isArray(result.forecastDays)).toBe(true);
    // Should return at most 3 days
    expect(result.forecastDays.length).toBeLessThanOrEqual(3);
  });
});

test.describe('Air Quality Tool Tests', () => {
  const getTool = (name: string) => googleMapsTools.find(
    (t) => t.definition.name === name
  );

  test('get_air_quality_by_location (current) should return data', async () => {
    const tool = getTool('get_air_quality_by_location');
    expect(tool).toBeDefined();



    // No dates = current conditions
    const result = await tool?.execute({ location: 'San Francisco' });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('indexes'); // Standard AQI response key
  });

  test('get_air_quality_by_coordinates (forecast) should return forecast', async () => {
    const tool = getTool('get_air_quality_by_coordinates');
    expect(tool).toBeDefined();

    const lat = 37.7749;
    const lng = -122.4194;

    // Create a date 24 hours in the future
    const tomorrow = new Date();
    tomorrow.setHours(tomorrow.getHours() + 24);
    const tomorrowISO = tomorrow.toISOString();

    const result = await tool?.execute({
      latitude: lat,
      longitude: lng,
      dates: [tomorrowISO]
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('results');
    expect(Array.isArray(result.results)).toBe(true);
  });

  test('get_air_quality_by_location (history) should return history', async () => {
    const tool = getTool('get_air_quality_by_location');

    // Create a date 24 hours in the past
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);
    const yesterdayISO = yesterday.toISOString();

    const result = await tool?.execute({
      location: 'San Francisco',
      dates: [yesterdayISO]
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('results');
    expect(Array.isArray(result.results)).toBe(true);
  });
});

test.describe('Places Tool Tests', () => {
  const getTool = (name: string) => googleMapsTools.find(
    (t) => t.definition.name === name
  );

  test('search_places should find a known location', async () => {
    const tool = getTool('search_places');
    expect(tool).toBeDefined();

    const result = await tool?.execute({
      textQuery: 'Eiffel Tower',
      maxResultCount: 5
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('places');
    expect(Array.isArray(result.places)).toBe(true);
    expect(result.places.length).toBeGreaterThan(0);

    // Check that the first result has expected properties
    const firstPlace = result.places[0];
    expect(firstPlace).toHaveProperty('displayName');
    expect(firstPlace).toHaveProperty('formattedAddress');
  });

  test('search_places with location bias should return results', async () => {
    const tool = getTool('search_places');

    const result = await tool?.execute({
      textQuery: 'coffee shop',
      maxResultCount: 3,
      locationBias: {
        circle: {
          center: { latitude: 37.7749, longitude: -122.4194 }, // San Francisco
          radius: 1000
        }
      }
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('places');
    expect(Array.isArray(result.places)).toBe(true);
  });
});

test.describe('Routes Tool Tests', () => {
  const getTool = (name: string) => googleMapsTools.find(
    (t) => t.definition.name === name
  );

  test('compute_routes should return route between two addresses', async () => {
    const tool = getTool('compute_routes');
    expect(tool).toBeDefined();

    const result = await tool?.execute({
      origin: { address: 'San Francisco, CA' },
      destination: { address: 'Los Angeles, CA' },
      travelMode: 'DRIVE'
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('routes');
    expect(Array.isArray(result.routes)).toBe(true);
    expect(result.routes.length).toBeGreaterThan(0);

    // Check route has expected properties
    const firstRoute = result.routes[0];
    expect(firstRoute).toHaveProperty('distanceMeters');
    expect(firstRoute).toHaveProperty('duration');
  });

  test('compute_routes with coordinates should work', async () => {
    const tool = getTool('compute_routes');

    const result = await tool?.execute({
      origin: {
        location: {
          latLng: { latitude: 37.7749, longitude: -122.4194 } // SF
        }
      },
      destination: {
        location: {
          latLng: { latitude: 37.3382, longitude: -121.8863 } // San Jose
        }
      },
      travelMode: 'DRIVE'
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('routes');
    expect(Array.isArray(result.routes)).toBe(true);
  });
});
