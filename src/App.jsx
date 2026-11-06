import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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

// Ultra-fast fuzzy field finder
const findValue = (row, candidates, fallback = '') => {
  if (!row) return fallback;
  const keys = Object.keys(row);
  for (const c of candidates) {
    const cleanCandidate = c.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const matchedKey = keys.find(
      (k) => k.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === cleanCandidate
    );
    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null) {
      const val = String(row[matchedKey]).trim();
      if (val !== '') return val;
    }
  }
  return fallback;
};

// High-speed Canvas Layer for 27,000+ points
const FastCanvasMarkers = ({ naps, activeNapCode, onSelectNap }) => {
  const map = useMap();
  const layerGroupRef = useRef(L.layerGroup());

  const renderMarkers = useCallback(() => {
    const layer = layerGroupRef.current;
    layer.clearLayers();
    if (!naps || naps.length === 0) return;

    const bounds = map.getBounds();
    const currentZoom = map.getZoom();

    // PERFORMANCE RULE: Never render more than 400 markers simultaneously to maintain 60 FPS
    let renderedCount = 0;
    const MAX_MARKERS_ON_SCREEN = 400;

    for (let i = 0; i < naps.length; i++) {
      const nap = naps[i];
      const lat = nap.lat;
      const lng = nap.lng;

      // Skip invalid or off-screen coordinates
      if (!bounds.contains([lat, lng])) continue;

      const isActive = activeNapCode && nap.napCode === activeNapCode;

      // If zoomed out far (zoom < 12) and not an active search, skip every Nth marker to prevent lag
      if (currentZoom < 12 && naps.length > 500 && !isActive) {
        if (i % 8 !== 0) continue;
      }

      const marker = L.circleMarker([lat, lng], {
        radius: isActive ? 8 : currentZoom > 14 ? 6 : 4,
        color: isActive ? '#f59e0b' : '#0284c7',
        fillColor: isActive ? '#fbbf24' : '#38bdf8',
        fillOpacity: isActive ? 1 : 0.85,
        weight: isActive ? 2 : 1,
      });

      const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

      marker.bindPopup(`
        <div style="font-family: inherit; font-size: 13px; min-width: 210px; color: #0f172a; line-height: 1.4;">
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: #0284c7;">${nap.napCode}</div>
          <div><strong>LCP:</strong> ${nap.lcpCode}</div>
          <div><strong>Area:</strong> ${nap.area}</div>
          <div><strong>Ports:</strong> ${nap.ports}</div>
          <div style="margin-top: 4px; font-size: 11px; color: #64748b; font-family: monospace;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
          <div style="margin-top: 8px;">
            <a href="${navUrl}" target="_blank" rel="noopener noreferrer" style="display: block; text-align: center; background: #0284c7; color: white; padding: 6px 10px; border-radius: 4px; text-decoration: none; font-size: 12px; font-weight: 600;">Directions ↗</a>
          </div>
        </div>
      `);

      marker.on('click', () => {
        if (onSelectNap) onSelectNap(nap);
      });

      layer.addLayer(marker);
      renderedCount++;

      if (renderedCount >= MAX_MARKERS_ON_SCREEN) break;
    }
  }, [map, naps, activeNapCode, onSelectNap]);

  useEffect(() => {
    layerGroupRef.current.addTo(map);
    renderMarkers();

    const onMoveEnd = () => renderMarkers();
    map.on('moveend', onMoveEnd);

    return () => {
      map.off('moveend', onMoveEnd);
      layerGroupRef.current.clearLayers();
    };
  }, [map, renderMarkers]);

  return null;
};

// Map auto-fit & resize controller
const MapController = ({ filteredNaps, searchQuery }) => {
  const map = useMap();

  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);

  // When search query yields 1-15 results, auto-fly to them!
  useEffect(() => {
    if (searchQuery.trim().length >= 3 && filteredNaps.length > 0 && filteredNaps.length <= 15) {
      const first = filteredNaps[0];
      map.flyTo([first.lat, first.lng], 16, { animate: true, duration: 0.8 });
    }
  }, [filteredNaps, searchQuery, map]);

  return null;
};

export default function App() {
  const [allNaps, setAllNaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedLcp, setSelectedLcp] = useState('ALL');
  const [activeNapCode, setActiveNapCode] = useState(null);
  const [mobileTab, setMobileTab] = useState('map');
  const [copiedId, setCopiedId] = useState(null);
  const mapRef = useRef(null);

  // 1. Debounce search input by 200ms so typing never stutters
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchInput);
    }, 200);
    return () => clearTimeout(handler);
  }, [searchInput]);

  // 2. Fetch live data from Google Sheet with robust field extraction
  useEffect(() => {
    Papa.parse(GOOGLE_SHEET_CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const parsed = [];
          const rows = results.data;

          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const rawLat = findValue(r, ['Latitude', 'LATITUDE', 'lat', 'LAT']);
            const rawLng = findValue(r, ['Longitude', 'LONGITUDE', 'lng', 'long', 'LONG', 'LON']);
            const lat = parseFloat(rawLat);
            const lng = parseFloat(rawLng);

            if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
              const napCode = findValue(r, ['NAP CODE', 'NAP', 'NAP Code', 'nap_code', 'NAP_CODE'], `NAP-${i + 1}`);
              // Thorough matching for LCP column variations
              const lcpCode = findValue(r, ['LCP CODE', 'LCP', 'LCP Code', 'lcp_code', 'LCP_CODE', 'LCP ID', 'LCP NO', 'FEEDER'], 'N/A');
              const area = findValue(r, ['AREA', 'Area', 'area', 'LOCATION', 'CLUSTER'], 'MTF BICOL');
              const ports = findValue(r, ['PORTS', 'Ports', 'ports', 'PORT', 'CAPACITY'], '16');

              parsed.push({
                id: i,
                lat,
                lng,
                napCode,
                lcpCode,
                area,
                ports,
              });
            }
          }
          setAllNaps(parsed);
        }
        setLoading(false);
      },
      error: (err) => {
        console.error('Sheet sync error:', err);
        setLoading(false);
      },
    });
  }, []);

  // 3. Extract unique LCP options safely
  const lcpOptions = useMemo(() => {
    const unique = new Set();
    for (let i = 0; i < allNaps.length; i++) {
      const code = allNaps[i].lcpCode;
      if (code && code !== 'N/A') {
        unique.add(code);
      }
    }
    return Array.from(unique).sort();
  }, [allNaps]);

  // 4. Memoized instant filter
  const filteredNaps = useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim();

    return allNaps.filter((n) => {
      const matchesLcp = selectedLcp === 'ALL' || n.lcpCode === selectedLcp;
      if (!matchesLcp) return false;

      if (!q) return true;

      return (
        n.napCode.toLowerCase().includes(q) ||
        n.lcpCode.toLowerCase().includes(q) ||
        n.area.toLowerCase().includes(q)
      );
    });
  }, [allNaps, selectedLcp, debouncedQuery]);

  // GPS Locate Me
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert('GPS is not supported on this device.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (mapRef.current) {
          mapRef.current.flyTo([latitude, longitude], 16, { animate: true });
        }
      },
      (err) => alert('Could not get GPS location: ' + err.message),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSelectNap = useCallback((nap) => {
    setActiveNapCode(nap.napCode);
    if (mapRef.current && typeof nap.lat === 'number') {
      mapRef.current.flyTo([nap.lat, nap.lng], 17, { animate: true });
    }
  }, []);

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans antialiased">
      {/* Header Bar */}
      <header className="bg-slate-950 border-b border-slate-800 px-4 py-3 sticky top-0 z-50 flex items-center justify-between shadow-md">
        <div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-sky-400">
            ALMASOR NAP LOCATOR
          </h1>
          <p className="text-xs text-slate-400">Live Auto-Sync: NAP LOCATOR</p>
        </div>

        <button
          onClick={handleLocateMe}
          className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow transition"
        >
          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
          </svg>
          <span>Locate Me</span>
        </button>
      </header>

      {/* Main Container */}
      <main className="flex-1 p-3 sm:p-5 max-w-7xl w-full mx-auto flex flex-col gap-3">
        {/* Controls */}
        <div className="bg-slate-800/90 backdrop-blur border border-slate-700 rounded-xl p-3 flex flex-col sm:flex-row gap-3 shadow-sm">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Search NAP / Area / LCP
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search NAP code (e.g. LIA001 LP81), Area, or LCP..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-3 pr-8 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-white"
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
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
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

        {/* Map & Table Workspace */}
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
                center={[13.19, 123.75]} // Centered directly on Albay/Legazpi/Tabaco area
                zoom={12}
                preferCanvas={true}
                className="w-full h-full"
                style={{ width: '100%', height: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                />
                <MapController filteredNaps={filteredNaps} searchQuery={debouncedQuery} />
                <FastCanvasMarkers
                  naps={filteredNaps}
                  activeNapCode={activeNapCode}
                  onSelectNap={handleSelectNap}
                />
              </MapContainer>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
                <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-sky-400"></div>
                <span>Syncing 27,000+ NAP records...</span>
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
                  Showing {Math.min(filteredNaps.length, 100)} of {filteredNaps.length} filtered
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-700/50">
              {filteredNaps.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400">
                  {loading ? 'Fetching data...' : 'No matching NAP records found.'}
                </div>
              ) : (
                filteredNaps.slice(0, 100).map((nap) => {
                  const isActive = activeNapCode === nap.napCode;
                  const latText = nap.lat.toFixed(5);
                  const lngText = nap.lng.toFixed(5);

                  return (
                    <div
                      key={nap.id}
                      onClick={() => handleSelectNap(nap)}
                      className={`p-3 text-xs cursor-pointer transition hover:bg-slate-700/40 ${
                        isActive ? 'bg-sky-950/60 border-l-4 border-sky-400' : ''
                      }`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-bold text-sky-400 text-sm">{nap.napCode}</span>
                        <span className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] text-slate-300">
                          {nap.ports} Ports
                        </span>
                      </div>

                      <div className="text-slate-300 text-xs truncate">
                        <span className="text-slate-400">LCP:</span> {nap.lcpCode} | {nap.area}
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/40">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(nap.id, `${nap.lat}, ${nap.lng}`);
                          }}
                          className="text-[11px] text-slate-400 hover:text-sky-300 font-mono"
                        >
                          {copiedId === nap.id ? '✓ Copied' : `${latText}, ${lngText}`}
                        </button>

                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${nap.lat},${nap.lng}`}
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
