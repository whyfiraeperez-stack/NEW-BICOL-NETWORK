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

// Helper: Safely resolve varied header naming conventions in Google Sheets
const getFieldValue = (obj, candidateKeys, defaultValue = '') => {
  if (!obj) return defaultValue;
  const keys = Object.keys(obj);
  for (const candidate of candidateKeys) {
    const matchedKey = keys.find(
      (k) => k.trim().toLowerCase() === candidate.trim().toLowerCase()
    );
    if (matchedKey && obj[matchedKey] !== undefined && obj[matchedKey] !== null) {
      const val = String(obj[matchedKey]).trim();
      if (val !== '') return val;
    }
  }
  return defaultValue;
};

// Canvas fast markers with screen bounds rendering
const FastMarkers = ({ naps, activeNapCode, onSelectNap }) => {
  const map = useMap();
  const layerGroupRef = useRef(L.layerGroup());

  const renderMarkers = () => {
    layerGroupRef.current.clearLayers();
    const bounds = map.getBounds();

    naps.forEach((nap) => {
      const lat = nap._lat;
      const lng = nap._lng;
      if (isNaN(lat) || isNaN(lng)) return;

      // Only draw markers within current view for smooth 60fps interaction
      if (!bounds.contains([lat, lng])) return;

      const isActive = activeNapCode && nap._napCode === activeNapCode;

      const marker = L.circleMarker([lat, lng], {
        radius: isActive ? 8 : 5,
        color: isActive ? '#f59e0b' : '#0ea5e9',
        fillColor: isActive ? '#fbbf24' : '#38bdf8',
        fillOpacity: isActive ? 1 : 0.8,
        weight: isActive ? 2 : 1,
      });

      const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

      const popupContent = `
        <div style="font-family: inherit; font-size: 13px; min-width: 200px; color: #0f172a;">
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: #0284c7;">${nap._napCode}</div>
          <div><strong>LCP:</strong> ${nap._lcpCode}</div>
          <div><strong>Area:</strong> ${nap._area}</div>
          <div><strong>Ports:</strong> ${nap._ports}</div>
          <div style="margin-top: 6px; font-size: 11px; color: #64748b;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
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

// Map size invalidate on mobile orientation change
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

  // 1. Google Sheets Live Auto-Sync
  useEffect(() => {
    // Check cached data first
    try {
      const cached = localStorage.getItem('bicol_nap_cache');
      if (cached) {
        const parsedCache = JSON.parse(cached);
        if (Array.isArray(parsedCache) && parsedCache.length > 50) {
          setNaps(parsedCache);
          setLoading(false);
        }
      }
    } catch (e) {
      console.warn('Cache error:', e);
    }

    // Fetch live from Google Sheets
    Papa.parse(GOOGLE_SHEET_CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const normalized = [];

          results.data.forEach((row, index) => {
            const rawLat = getFieldValue(row, ['Latitude', 'LATITUDE', 'lat', 'LAT']);
            const rawLng = getFieldValue(row, ['Longitude', 'LONGITUDE', 'lng', 'long', 'LONG', 'LON']);
            const lat = parseFloat(rawLat);
            const lng = parseFloat(rawLng);

            // Valid coordinate check
            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
              const napCode = getFieldValue(row, ['NAP CODE', 'NAP', 'NAP Code', 'nap_code'], `NAP-${index + 1}`);
              const lcpCode = getFieldValue(row, ['LCP CODE', 'LCP', 'LCP Code', 'lcp_code'], 'N/A');
              const area = getFieldValue(row, ['AREA', 'Area', 'area', 'LOCATION'], 'N/A');
              const ports = getFieldValue(row, ['PORTS', 'Ports', 'ports', 'PORT'], '16');

              normalized.push({
                ...row,
                _lat: lat,
                _lng: lng,
                _napCode: napCode,
                _lcpCode: lcpCode,
                _area: area,
                _ports: ports,
              });
            }
          });

          if (normalized.length > 0) {
            setNaps(normalized);
            localStorage.setItem('bicol_nap_cache', JSON.stringify(normalized));
          }
        }
        setLoading(false);
      },
      error: (err) => {
        console.error('Spreadsheet sync error:', err);
        setLoading(false);
      },
    });
  }, []);

  // 2. Extract unique LCP codes
  const lcpOptions = useMemo(() => {
    const set = new Set();
    naps.forEach((n) => {
      if (n._lcpCode && n._lcpCode !== 'N/A') {
        set.add(n._lcpCode);
      }
    });
    return Array.from(set).sort();
  }, [naps]);

  // 3. Multi-field search
  const filteredNaps = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return naps.filter((n) => {
      const matchesLcp = selectedLcp === 'ALL' || n._lcpCode === selectedLcp;
      if (!matchesLcp) return false;

      if (!q) return true;

      return (
        n._napCode.toLowerCase().includes(q) ||
        n._lcpCode.toLowerCase().includes(q) ||
        n._area.toLowerCase().includes(q) ||
        String(n._lat).includes(q) ||
        String(n._lng).includes(q)
      );
    });
  }, [naps, selectedLcp, searchQuery]);

  // 4. GPS Locate Me
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

  // 5. Select Row -> Center Map
  const handleSelectNap = (nap) => {
    setActiveNapCode(nap._napCode);
    if (mapRef.current && !isNaN(nap._lat) && !isNaN(nap._lng)) {
      mapRef.current.flyTo([nap._lat, nap._lng], 17, { animate: true });
    }
  };

  // 6. Copy Coordinates
  const handleCopy = (idx, text) => {
    navigator.clipboard.writeText(text);
    setCopiedCoord(idx);
    setTimeout(() => setCopiedCoord(null), 1500);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header Bar */}
      <header className="bg-slate-950 border-b border-slate-800 px-4 py-3 sticky top-0 z-50 flex items-center justify-between">
        <div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-sky-400">
            ALMASOR NAP LOCATOR
          </h1>
          <p className="text-xs text-slate-400">Live Auto-Sync: NAP LOCATOR</p>
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
        {/* Search & Filter Bar */}
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

        {/* Workspace: Map + Table */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[620px] flex-1">
          {/* Map Column */}
          <div
            className={`lg:col-span-2 bg-slate-800 border border-slate-700 rounded-xl overflow-hidden relative ${
              mobileTab === 'map' ? 'h-[62vh] min-h-[380px]' : 'hidden sm:block'
            } lg:h-full`}
          >
            {!loading ? (
              <MapContainer
                ref={mapRef}
                center={[13.41, 123.41]}
                zoom={9}
                preferCanvas={true}
                className="w-full h-full"
                style={{ width: '100%', height: '100%' }}
              >
                <MapResizer />
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                <FastMarkers
                  naps={filteredNaps}
                  activeNapCode={activeNapCode}
                  onSelectNap={handleSelectNap}
                />
              </MapContainer>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-sky-400"></div>
                <span>Syncing NAP Records from Google Sheets...</span>
              </div>
            )}
          </div>

          {/* Table Column */}
          <div
            className={`bg-slate-800 border border-slate-700 rounded-xl overflow-hidden flex flex-col ${
              mobileTab === 'table' ? 'h-[65vh]' : 'hidden sm:flex'
            } lg:h-full`}
          >
            <div className="p-3 border-b border-slate-700 bg-slate-800/80 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">NAP Records</h3>
                <p className="text-xs text-slate-400">
                  Showing {filteredNaps.length} of {naps.length} nodes
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
              {filteredNaps.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  {loading ? 'Fetching data...' : 'No matching NAP records found.'}
                </div>
              ) : (
                filteredNaps.slice(0, 300).map((nap, idx) => {
                  const isActive = activeNapCode === nap._napCode;

                  return (
                    <div
                      key={idx}
                      onClick={() => handleSelectNap(nap)}
                      className={`p-3 text-xs cursor-pointer transition hover:bg-slate-700/40 ${
                        isActive ? 'bg-sky-950/60 border-l-4 border-sky-400' : ''
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-sky-400 text-sm">{nap._napCode}</span>
                        <span className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] text-slate-300">
                          {nap._ports} Ports
                        </span>
                      </div>

                      <div className="text-slate-300 text-xs truncate">
                        <span className="text-slate-400">LCP:</span> {nap._lcpCode} | {nap._area}
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/40">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(idx, `${nap._lat}, ${nap._lng}`);
                          }}
                          className="text-[11px] text-slate-400 hover:text-sky-300 font-mono"
                        >
                          {copiedCoord === idx
                            ? '✓ Copied'
                            : `${nap._lat.toFixed(5)}, ${nap._lng.toFixed(5)}`}
                        </button>

                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${nap._lat},${nap._lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 inline-flex items-center gap-0.5"
                        >
                          Directions ↗
                        </a>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
