
import { useState, useEffect, useCallback, useRef } from 'react';

// Configuration constants
const UPDATE_MAX_AGE_MS = 60 * 1000; // 1 minute
const STALE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
const STORAGE_KEY_LOCATION = 'user:location';
const STORAGE_KEY_TRACKING = 'user:location:tracking';

export interface LocationData {
  lat: number;
  lng: number;
  lastUpdated: number;
}

export interface UseLocationResult {
  location: LocationData | null;
  isTrackingEnabled: boolean;
  toggleTracking: () => void;
  getLocation: (onStatusUpdate?: (status: string) => void) => Promise<string | undefined>;
}

export function useLocation(): UseLocationResult {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [isTrackingEnabled, setIsTrackingEnabled] = useState<boolean>(true);
  const isMountedRef = useRef(false);

  // Initialize from localStorage
  useEffect(() => {
    isMountedRef.current = true;
    try {
      const savedLocation = localStorage.getItem(STORAGE_KEY_LOCATION);
      if (savedLocation) {
        setLocation(JSON.parse(savedLocation));
      }

      const savedTracking = localStorage.getItem(STORAGE_KEY_TRACKING);
      if (savedTracking !== null) {
        setIsTrackingEnabled(savedTracking === 'true');
      }
    } catch (e) {
      console.error('Failed to load location settings', e);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const saveLocation = useCallback((data: LocationData) => {
    setLocation(data);
    localStorage.setItem(STORAGE_KEY_LOCATION, JSON.stringify(data));
  }, []);

  const toggleTracking = useCallback(() => {
    setIsTrackingEnabled(prev => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEY_TRACKING, String(newValue));
      return newValue;
    });
  }, []);

  // Helper to get fresh position from browser
  const fetchPosition = useCallback(async (): Promise<LocationData> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            lastUpdated: Date.now()
          });
        },
        (err) => reject(err),
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0
        }
      );
    });
  }, []);

  const getLocation = useCallback(async (onStatusUpdate?: (status: string) => void): Promise<string | undefined> => {
    if (!isTrackingEnabled) return undefined;

    const now = Date.now();
    const hasLocation = !!location;
    const cacheAge = location ? now - location.lastUpdated : Infinity;

    // Happy Path: Fresh enough to use immediately?
    if (hasLocation && cacheAge < STALE_MAX_AGE_MS) {
      // Return immediately
      const locationString = `${location.lat},${location.lng}`;

      // If older than update age, trigger background refresh
      if (cacheAge > UPDATE_MAX_AGE_MS) {
        fetchPosition()
          .then(saveLocation)
          .catch(e => console.warn('Background location update failed:', e));
      }

      return locationString;
    }

    // Stale/Missing Path: Must wait for new location
    try {
      // Setup status message timer
      let statusTimer: NodeJS.Timeout | null = null;

      if (onStatusUpdate) {
        statusTimer = setTimeout(() => {
          if (isMountedRef.current) {
            onStatusUpdate("Getting location...");
          }
        }, 2000); // 2 second threshold
      }

      const newLocation = await fetchPosition();

      if (statusTimer) clearTimeout(statusTimer);

      saveLocation(newLocation);
      return `${newLocation.lat},${newLocation.lng}`;
    } catch (error) {
      console.error('Failed to get location:', error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }, [isTrackingEnabled, location, fetchPosition, saveLocation]);

  return {
    location,
    isTrackingEnabled,
    toggleTracking,
    getLocation
  };
}
