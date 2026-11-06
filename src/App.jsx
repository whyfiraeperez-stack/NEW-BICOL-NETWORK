import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import Papa from 'papaparse';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default Leaflet icon paths in React Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Published Google Sheet CSV endpoint for NAP LOCATOR tab
const GOOGLE_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1DgYA7-nM4DoVg70YOEGlu4Au7nb7xNpdSzyW8BZFsOg/gviz/tq?tqx=out:csv&sheet=NAP%20LOCATOR';

// Safely extract field values regardless of sheet column case or whitespace
const getVal = (obj, keys, fallback = '') => {
  if (!obj) return fallback;
  const objKeys = Object.keys(obj);
  for (const k of keys) {
    const foundKey = objKeys.find((item) => item.trim().toLowerCase() === k.trim().toLowerCase());
    if (foundKey && obj[foundKey] !== undefined && obj[foundKey] !== null) {
      const val = String(obj[foundKey]).trim();
      if (val !== '') return val;
    }
  }
  return fallback;
};

// Canvas fast markers with screen bounds rendering (handles 27k+ nodes smoothly)
const FastMarkers = ({ naps, activeNapCode, onSelectNap }) => {
  const map = useMap();
  const layerGroupRef = useRef(L.layerGroup());

  const renderMarkers = () => {
    layerGroupRef.current.clearLayers();
    const bounds = map.getBounds();

    naps.forEach((nap) => {
      const lat = nap.lat;
      const lng = nap.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;

      // Only draw markers inside the screen view for 60fps performance
      if (!bounds.contains([lat, lng])) return;

      const isActive = activeNapCode && nap.napCode === activeNapCode;

      const marker = L.circleMarker([lat, lng], {
        radius: isActive ? 8 : 5,
        color: isActive ? '#f59e0b' : '#0ea5e9',
        fillColor: isActive ? '#fbbf24' : '#38bdf8',
        fillOpacity: isActive ? 1 : 0.8,
        weight: isActive ? 2 : 1,
      });

      const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      const latText = lat.toFixed(6);
      const lngText = lng.toFixed(6);

      const popupContent = `
        <div style="font-family: inherit; font-size: 13px; min-width: 200px; color: #0f172a;">
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: #0284c7;">${nap.napCode}</div>
          <div><strong>LCP:</strong> ${nap.lcpCode}</div>
          <div><strong>Area:</strong> ${nap.area}</div>
          <div><strong>Ports:</strong> ${nap.ports}</div>
          <div style="margin-top: 6px; font-size: 11px; color: #64748b;">${latText}, ${lngText}</div>
          <div style="margin-top: 8px;">
            <a href="${navUrl}" target="_blank" rel="noopener noreferrer" style="display: block; text-align: center; background: #0284c7; color: white; padding: 5px 8px; border-radius: 4px; text-decoration: none; font-size: 12px; font-weight: 600;">Directions ↗</a>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on('click', () => {
        if (onSelectNap) onSelectNap(nap);
      });

      layerGroupRef.current.addLayer(marker);
    });
  };

  useEffect(() => {
    layerGroupRef.current.addTo(map);
    renderMarkers();

    const handleMove = () => renderMarkers();
    map.on('moveend', handleMove);

    return () => {
      map.off('moveend', handleMove);
      layerGroupRef.current.clearLayers();
    };
  }, [map, naps, activeNapCode]);

  return null;
};

// Auto-resizes Leaflet container on mobile orientation change
const MapResizer = () => {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 250);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
};

export default function App() {
  const [naps, setNaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLcp, setSelectedLcp] = useState('ALL');
  const [activeNapCode, setActiveNapCode] = useState(null);
  const [mobileTab, setMobileTab] = useState('map');
  const [copiedCoord, setCopiedCoord] = useState(null);
  const mapRef = useRef(null);

  // Live Auto-Sync from Google Sheets
  useEffect(() => {
    // Clean up any stale localStorage that exceeded the quota
    try {
      localStorage.removeItem('bicol_nap_cache');
    } catch (e) {
      /* ignore */
    }

    Papa.parse(GOOGLE_SHEET_CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const parsedRows = [];

          for (let i = 0; i < results.data.length; i++) {
            const row = results.data[i];
            const rawLat = getVal(row, ['Latitude', 'LATITUDE', 'lat', 'LAT']);
            const rawLng = getVal(row, ['Longitude', 'LONGITUDE', 'lng', 'long', 'LONG', 'LON']);
            const lat = parseFloat(rawLat);
            const lng = parseFloat(rawLng);

            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
              parsedRows.push({
                id: i,
                lat,
                lng,
                napCode: getVal(row, ['NAP CODE', 'NAP', 'NAP Code', 'nap_code'], `NAP-${i + 1}`),
                lcpCode: getVal(row, ['LCP CODE', 'LCP', 'LCP Code', 'lcp_code'], 'N/A'),
                area: getVal(row, ['AREA', 'Area', 'area', 'LOCATION'], 'N/A'),
                ports: getVal(row, ['PORTS', 'Ports', 'ports', 'PORT'], '16'),
              });
            }
          }

          setNaps(parsedRows);
        }
        setLoading(false);
      },
      error: (err) => {
        console.error('Google Sheet Sync Error:', err);
        setLoading(false);
      },
    });
  }, []);

  // Unique LCP options
  const lcpOptions = useMemo(() => {
    const set = new Set();
    naps.forEach((n) => {
      if (n.lcpCode && n.lcpCode !== 'N/A') {
        set.add(n.lcpCode);
      }
    });
    return Array.from(set).sort();
  }, [naps]);

  // Fast search filter across NAP, LCP, Area, and Coordinates
  const filteredNaps = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return naps.filter((n) => {
      const matchesLcp = selectedLcp === 'ALL' || n.lcpCode === selectedLcp;
      if (!matchesLcp) return false;

      if (!q) return true;

      return (
        n.napCode.toLowerCase().includes(q) ||
        n.lcpCode.toLowerCase().includes(q) ||
        n.area.toLowerCase().includes(q) ||
        String(n.lat).includes(q) ||
        String(n.lng).includes(q)
      );
    });
  }, [naps, selectedLcp, searchQuery]);

  // GPS Locate Me
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert('GPS is not supported by your browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (mapRef.current) {
          mapRef.current.flyTo([latitude, longitude], 16, { animate: true });
        }
      },
      (err) => {
        alert('Could not acquire GPS: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Center on Selected NAP
  const handleSelectNap = (nap) => {
    setActiveNapCode(nap.napCode);
    if (mapRef.current && typeof nap.lat === 'number' && typeof nap.lng === 'number') {
      mapRef.current.flyTo([nap.lat, nap.lng], 17, { animate: true });
    }
  };

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedCoord(id);
    setTimeout(() => setCopiedCoord(null), 1500);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="bg-slate-950 border-b border-slate-800 px-4 py-3 sticky top-0 z-50 flex items-center justify-between">
        <div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-sky-400">
            ALMASOR NAP LOCATOR
          </h1>
          <p className="text-xs text-slate-400">Live Auto-Sync: NAP LOCATOR Tab</p>
        </div>

        <button
          onClick={handleLocateMe}
          className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-md transition"
        >
          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
          </svg>
          <span>Locate Me</span>
        </button>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-3 sm:p-5 max-w-7xl w-full mx-auto flex flex-col gap-3">
        {/* Filters */}
        <div className="bg-slate-800/80 backdrop-blur border border-slate-700/80 rounded-xl p-3 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Search NAP / Area / LCP
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search any NAP code (e.g. LIA001), Area, or LCP..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-slate-200"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="w-full sm:w-64">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Filter by LCP Code
            </label>
            <select
              value={selectedLcp}
              onChange={(e) => setSelectedLcp(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="ALL">All LCP Codes ({lcpOptions.length})</option>
              {lcpOptions.map((lcp) => (
                <option key={lcp} value={lcp}>
                  {lcp}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mobile View Switcher */}
        <div className="flex sm:hidden bg-slate-800 p-1 rounded-lg border border-slate-700">
          <button
            onClick={() => setMobileTab('map')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
              mobileTab === 'map' ? 'bg-sky-600 text-white' : 'text-slate-400'
            }`}
          >
            Map View
          </button>
          <button
            onClick={() => setMobileTab('table')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition ${
              mobileTab === 'table' ? 'bg-sky-600 text-white' : 'text-slate-400'
            }`}
          >
            Table Records ({filteredNaps.length})
          </button>
        </div>

        {/* Layout: Tall on mobile (62vh), 620px side-by-side on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:
