import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import Papa from 'papaparse';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default Leaflet icon paths in React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Published Google Sheet CSV endpoint for NAP LOCATOR tab
const GOOGLE_SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1DgYA7-nM4DoVg70YOEGlu4Au7nb7xNpdSzyW8BZFsOg/gviz/tq?tqx=out:csv&sheet=NAP%20LOCATOR';

// Fast Native Markers using Canvas + Viewport Culling
const FastMarkers = ({ naps, activeNapCode, onSelectNap }) => {
  const map = useMap();
  const layerGroupRef = useRef(L.layerGroup());

  const renderMarkers = () => {
    layerGroupRef.current.clearLayers();
    const bounds = map.getBounds();

    naps.forEach((nap) => {
      const lat = parseFloat(nap.Latitude || nap.LATITUDE || nap.lat);
      const lng = parseFloat(nap.Longitude || nap.LONGITUDE || nap.lng || nap.long);
      if (isNaN(lat) || isNaN(lng)) return;

      // Only draw markers inside the visible screen view for high performance
      if (!bounds.contains([lat, lng])) return;

      const napCode = nap['NAP CODE'] || nap['NAP Code'] || nap.nap_code || 'N/A';
      const lcpCode = nap['LCP CODE'] || nap['LCP Code'] || nap.lcp_code || 'N/A';
      const area = nap.AREA || nap.Area || nap.area || 'N/A';
      const ports = nap.PORTS || nap.Ports || nap.ports || '16';

      const isActive = activeNapCode && napCode === activeNapCode;

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
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px; color: #0284c7;">${napCode}</div>
          <div><strong>LCP:</strong> ${lcpCode}</div>
          <div><strong>Area:</strong> ${area}</div>
          <div><strong>Ports:</strong> ${ports}</div>
          <div style="margin-top: 6px; font-size: 11px; color: #64748b;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <a href="${navUrl}" target="_blank" rel="noopener noreferrer" style="flex: 1; text-align: center; background: #0284c7; color: white; padding: 4px 8px; border-radius: 4px; text-decoration: none; font-size: 12px; font-weight: 600;">Directions ↗</a>
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

// Auto-resizes Leaflet container when loaded on mobile
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
  const [mobileTab, setMobileTab] = useState('map'); // 'map' or 'table'
  const [copiedCoord, setCopiedCoord] = useState(null);
  const mapRef = useRef(null);

  // Auto-sync from Google Sheets NAP LOCATOR tab
  useEffect(() => {
    // 1. Check local cache first for instant mobile rendering
    const cachedData = localStorage.getItem('bicol_nap_cache');
    if (cachedData) {
      try {
        const parsed = JSON.parse(cachedData);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setNaps(parsed);
          setLoading(false);
        }
      } catch (e) {
        console.warn('Cache parsing fallback', e);
      }
    }

    // 2. Fetch live data from Google Sheet
    Papa.parse(GOOGLE_SHEET_CSV_URL, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const cleanData = results.data.filter((row) => {
            const lat = parseFloat(row.Latitude || row.LATITUDE || row.lat);
            const lng = parseFloat(row.Longitude || row.LONGITUDE || row.lng || row.long);
            return !isNaN(lat) && !isNaN(lng);
          });

          setNaps(cleanData);
          localStorage.setItem('bicol_nap_cache', JSON.stringify(cleanData));
        }
        setLoading(false);
      },
      error: (err) => {
        console.error('Google Sheet Sync Error:', err);
        setLoading(false);
      },
    });
  }, []);

  // Extract unique LCP codes for dropdown
  const lcpOptions = useMemo(() => {
    const unique = new Set();
    naps.forEach((n) => {
      const code = n['LCP CODE'] || n['LCP Code'] || n.lcp_code;
      if (code) unique.add(code.trim());
    });
    return Array.from(unique).sort();
  }, [naps]);

  // Search & LCP Filter
  const filteredNaps = useMemo(() => {
    return naps.filter((n) => {
      const napCode = (n['NAP CODE'] || n['NAP Code'] || n.nap_code || '').toLowerCase();
      const lcpCode = (n['LCP CODE'] || n['LCP Code'] || n.lcp_code || '').trim();
      const area = (n.AREA || n.Area || n.area || '').toLowerCase();

      const matchesLcp = selectedLcp === 'ALL' || lcpCode === selectedLcp;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q || napCode.includes(q) || lcpCode.toLowerCase().includes(q) || area.includes(q);

      return matchesLcp && matchesSearch;
    });
  }, [naps, selectedLcp, searchQuery]);

  // GPS Locate Me
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
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
        alert('Could not get GPS location: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Fly map to selected NAP
  const handleSelectNap = (nap) => {
    const lat = parseFloat(nap.Latitude || nap.LATITUDE || nap.lat);
    const lng = parseFloat(nap.Longitude || nap.LONGITUDE || nap.lng || nap.long);
    const code = nap['NAP CODE'] || nap['NAP Code'] || nap.nap_code;
    setActiveNapCode(code);

    if (mapRef.current && !isNaN(lat) && !isNaN(lng)) {
      mapRef.current.flyTo([lat, lng], 17, { animate: true });
    }
  };

  const handleCopy = (idx, text) => {
    navigator.clipboard.writeText(text);
    setCopiedCoord(idx);
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
          <p className="text-xs text-slate-400">Live Sync from Google Sheets</p>
        </div>

        {/* Locate Me GPS Button */}
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

      {/* Main Content */}
      <main className="flex-1 p-3 sm:p-5 max-w-7xl w-full mx-auto flex flex-col gap-3">
        {/* Search & Filter Controls */}
        <div className="bg-slate-800/80 backdrop-blur border border-slate-700/80 rounded-xl p-3 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Search NAP / Area / LCP
            </label>
            <input
              type="text"
              placeholder="e.g. LIA001, MTF BICOL, 630..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
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

        {/* Mobile Tabs */}
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

        {/* Layout: Responsive on mobile, side-by-side on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[620px] flex-1">
          {/* Map Section */}
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
              <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
                Syncing NAP Records from Google Sheets...
              </div>
            )}
          </div>

          {/* Table Section */}
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
              {filteredNaps.slice(0, 300).map((nap, idx) => {
                const code = nap['NAP CODE'] || nap['NAP Code'] || nap.nap_code || `NAP-${idx}`;
                const lcp = nap['LCP CODE'] || nap['LCP Code'] || nap.lcp_code || 'N/A';
                const area = nap.AREA || nap.Area || nap.area || 'N/A';
                const ports = nap.PORTS || nap.Ports || nap.ports || '16';
                const lat = parseFloat(nap.Latitude || nap.LATITUDE || nap.lat);
                const lng = parseFloat(nap.Longitude || nap.LONGITUDE || nap.lng || nap.long);
                const isActive = activeNapCode === code;

                return (
                  <div
                    key={idx}
                    onClick={() => handleSelectNap(nap)}
                    className={`p-3 text-xs cursor-pointer transition hover:bg-slate-700/40 ${
                      isActive ? 'bg-sky-950/60 border-l-4 border-sky-400' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-sky-400 text-sm">{code}</span>
                      <span className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] text-slate-300">
                        {ports} Ports
                      </span>
                    </div>

                    <div className="text-slate-300 text-xs truncate">
                      <span className="text-slate-400">LCP:</span> {lcp} | {area}
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-700/40">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(idx, `${lat}, ${lng}`);
                        }}
                        className="text-[11px] text-slate-400 hover:text-sky-300 font-mono"
                      >
                        {copiedCoord === idx ? '✓ Copied' : `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
                      </button>

                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
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
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
