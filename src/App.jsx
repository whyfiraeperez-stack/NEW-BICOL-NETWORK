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

// Helper component: forces Leaflet to recalculate container bounds on mobile
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

// Canvas fast markers with optimized O(1) active highlighting & fast spatial search
const FastMarkers = ({ naps, activeNapCode, onMarkerClick }) => {
  const map = useMap();
  const markersRef = useRef({});
  const layerGroupRef = useRef(L.layerGroup());
  const prevActiveRef = useRef(null);

  // 1. Initial bulk render: ONLY runs when `naps` data changes, NOT on active row click
  useEffect(() => {
    const layer = layerGroupRef.current;
    layer.clearLayers();
    markersRef.current = {};

    naps.forEach((nap) => {
      const marker = L.circleMarker([nap.Latitude, nap.Longitude], {
        radius: 5,
        color: '#0ea5e9',
        fillColor: '#38bdf8',
        fillOpacity: 0.8,
        weight: 1,
      });

      const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${nap.Latitude},${nap.Longitude}`;

      const popupHtml = `
        <div style="font-family: sans-serif; color: #0f172a; min-width: 210px;">
          <strong style="display: block; font-size: 15px; margin-bottom: 6px; color: #0284c7;">${nap.NAP_Code}</strong>
          <p style="margin: 0 0 2px 0; font-size: 13px;"><strong>LCP:</strong> ${nap.LCP_Code}</p>
          <p style="margin: 0 0 2px 0; font-size: 13px;"><strong>Ports:</strong> ${nap.Ports || 'N/A'}</p>
          <p style="margin: 0 0 2px 0; font-size: 13px;"><strong>Area:</strong> ${nap.Area || 'Unknown'}</p>
          <p style="margin: 0 0 2px 0; font-size: 12px; font-family: monospace; color: #64748b;">${nap.Latitude.toFixed(6)}, ${nap.Longitude.toFixed(6)}</p>
          <div style="margin-top: 8px;">
            <a href="${navUrl}" target="_blank" rel="noopener noreferrer" style="display: block; text-align: center; background: #0284c7; color: white; padding: 5px 8px; border-radius: 4px; text-decoration: none; font-size: 12px; font-weight: 600;">Directions ↗</a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      layer.addLayer(marker);
      markersRef.current[nap.NAP_Code] = marker;
    });

    layer.addTo(map);

    return () => {
      layer.clearLayers();
      layer.removeFrom(map);
    };
  }, [naps, map]);

  // 2. High-performance Active NAP highlighter: updates ONLY the affected markers (instant, 0ms lag)
  useEffect(() => {
    // Reset previously highlighted marker back to default
    if (prevActiveRef.current && markersRef.current[prevActiveRef.current]) {
      markersRef.current[prevActiveRef.current].setStyle({
        radius: 5,
        color: '#0ea5e9',
        fillColor: '#38bdf8',
        weight: 1,
      });
    }

    // Highlight newly selected marker
    if (activeNapCode && markersRef.current[activeNapCode]) {
      const marker = markersRef.current[activeNapCode];
      marker.setStyle({
        radius: 9,
        color: '#f59e0b',
        fillColor: '#fbbf24',
        weight: 3,
      });
      prevActiveRef.current = activeNapCode;

      map.flyTo(marker.getLatLng(), 17, { duration: 1 });
      setTimeout(() => marker.openPopup(), 1050);
    }
  }, [activeNapCode, map]);

  // 3. Fast nearby facilities click: uses bounding box before distance sort (eliminates 27k lag)
  useEffect(() => {
    const onMapClick = (e) => {
      if (!naps || naps.length === 0) return;

      const clickLat = e.latlng.lat;
      const clickLng = e.latlng.lng;

      // FAST FILTER: Only consider NAPs within ~5km bounding box (approx 0.05 deg)
      // This reduces calculation from 27,000 items to ~15 items!
      const candidates = [];
      const delta = 0.05;

      for (let i = 0; i < naps.length; i++) {
        const nap = naps[i];
        if (
          Math.abs(nap.Latitude - clickLat) <= delta &&
          Math.abs(nap.Longitude - clickLng) <= delta
        ) {
          candidates.push({
            ...nap,
            distance: map.distance(e.latlng, L.latLng(nap.Latitude, nap.Longitude)),
          });
        }
      }

      // If clicked in an empty area, expand search slightly
      if (candidates.length === 0) {
        for (let i = 0; i < naps.length; i++) {
          const nap = naps[i];
          if (
            Math.abs(nap.Latitude - clickLat) <= 0.2 &&
            Math.abs(nap.Longitude - clickLng) <= 0.2
          ) {
            candidates.push({
              ...nap,
              distance: map.distance(e.latlng, L.latLng(nap.Latitude, nap.Longitude)),
            });
          }
        }
      }

      candidates.sort((a, b) => a.distance - b.distance);
      const nearest = candidates.slice(0, 5);

      if (nearest.length === 0) return;

      let html = `
        <div style="font-family: sans-serif; color: #0f172a; min-width: 220px;">
          <strong style="display: block; font-size: 14px; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px;">
            5 Nearest Facilities
          </strong>
      `;

      nearest.forEach((nap) => {
        const distStr =
          nap.distance < 1000
            ? `${Math.round(nap.distance)} m`
            : `${(nap.distance / 1000).toFixed(2)} km`;

        html += `
          <div style="margin-bottom: 8px; line-height: 1.2;">
            <strong style="font-size: 12px; color: #0284c7; display: block;">${nap.NAP_Code}</strong>
            <span style="font-size: 11px; color: #64748b;">${distStr} away • ${nap.Ports || 0} Ports</span>
            <p style="font-size: 10px; color: #94a3b8; margin: 2px 0 0 0;">${nap.Area || 'Unknown'}</p>
          </div>
        `;
      });
      html += `</div>`;

      L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
    };

    map.on('click', onMapClick);
    return () => {
      map.off('click', onMapClick);
    };
  }, [naps, map]);

  return null;
};

export default function App() {
  const [naps, setNaps] = useState([]);
  const [filteredNaps, setFilteredNaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState('All areas');
  const [selectedLcp, setSelectedLcp] = useState('All LCP codes');

  const [activeNapCode, setActiveNapCode] = useState(null);
  const [isMessengerView, setIsMessengerView] = useState(false);
  const [gpsStatus, setGpsStatus] = useState('');
  const mapRef = useRef(null);
  const userMarkerRef = useRef(null);

  // Check if inside Messenger In-App Browser
  useEffect(() => {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    if (ua.indexOf('FBAN') > -1 || ua.indexOf('FBAV') > -1 || ua.indexOf('Messenger') > -1) {
      setIsMessengerView(true);
    }
  }, []);

  // Debounce search input by 200ms to eliminate typing lag
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const areas = useMemo(
    () => ['All areas', ...new Set(naps.map((n) => n.Area).filter(Boolean))].sort(),
    [naps]
  );
  const lcps = useMemo(
    () => ['All LCP codes', ...new Set(naps.map((n) => n.LCP_Code).filter(Boolean))].sort(),
    [naps]
  );

  const SHEET_URL =
    'https://docs.google.com/spreadsheets/d/1DgYA7-nM4DoVg70YOEGlu4Au7nb7xNpdSzyW8BZFsOg/gviz/tq?tqx=out:csv&sheet=NAP%20LOCATOR';

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(SHEET_URL);
        const csvText = await response.text();

        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const parsedData = results.data
              .map((row) => {
                const getVal = (keys) => {
                  for (let k of keys) {
                    if (row[k] !== undefined && row[k] !== '') return String(row[k]).trim();
                    const foundKey = Object.keys(row).find(
                      (rk) => rk.toLowerCase().trim() === k.toLowerCase()
                    );
                    if (foundKey && row[foundKey] !== '') return String(row[foundKey]).trim();
                  }
                  return '';
                };

                const napCode = getVal([
                  'NAP CODE',
                  'NAP NAME',
                  'NAP',
                  'NODE CODE',
                  'NAP ID',
                  'DESCRIPTION',
                  'NAME',
                ]);
                const fallbackLcp = getVal(['LCP CODE', 'LCP', 'LCP NAME', 'LCP ID']);

                const rawLcpMatch =
                  (napCode.match(/\bLP\s*\d+\b/i) || [])[0] || fallbackLcp || '—';
                const cleanLcp =
                  typeof rawLcpMatch === 'string'
                    ? rawLcpMatch.replace(/\s+/g, ' ').toUpperCase()
                    : '—';

                return {
                  NAP_Code: napCode,
                  Ports: getVal([
                    'NO OF PORTS',
                    'NUMBER OF PORTS',
                    'PORTS',
                    'PORT COUNT',
                    'CAPACITY',
                    'NAP PORTS',
                  ]),
                  Area: getVal(['AREA', 'BARANGAY', 'LOCATION', 'ADDRESS', 'SITE']),
                  Latitude: parseFloat(
                    getVal(['LATITUDE', 'LAT', 'GPS LATITUDE', 'Y COORDINATE'])
                  ),
                  Longitude: parseFloat(
                    getVal(['LONGITUDE', 'LON', 'LONG', 'GPS LONGITUDE', 'X COORDINATE'])
                  ),
                  LCP_Code: cleanLcp,
                };
              })
              .filter(
                (n) =>
                  n.NAP_Code &&
                  !isNaN(n.Latitude) &&
                  !isNaN(n.Longitude) &&
                  n.Latitude >= -90 &&
                  n.Latitude <= 90 &&
                  n.Longitude >= -180 &&
                  n.Longitude <= 180
              );

            const uniqueNaps = Array.from(
              new Map(parsedData.map((item) => [item.NAP_Code, item])).values()
            );

            setNaps(uniqueNaps);
            setFilteredNaps(uniqueNaps);
            setLastUpdated(new Date().toLocaleTimeString());
            setLoading(false);
          },
          error: () => {
            setError('Failed to parse CSV data.');
            setLoading(false);
          },
        });
      } catch (err) {
        setError('Failed to connect to Google Sheets.');
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, []);

  // Filter computation using debounced search
  useEffect(() => {
    let result = naps;
    const q = debouncedSearch.toLowerCase().trim();

    if (q) {
      result = result.filter(
        (n) =>
          n.NAP_Code.toLowerCase().includes(q) ||
          n.LCP_Code.toLowerCase().includes(q) ||
          (n.Area && n.Area.toLowerCase().includes(q))
      );
    }
    if (selectedArea !== 'All areas') {
      result = result.filter((n) => n.Area === selectedArea);
    }
    if (selectedLcp !== 'All LCP codes') {
      result = result.filter((n) => n.LCP_Code === selectedLcp);
    }
    setFilteredNaps(result);
  }, [debouncedSearch, selectedArea, selectedLcp, naps]);

  // Robust Two-Tier GPS Locator (fixes 'Timeout expired')
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert('GPS is not supported on this browser.');
      return;
    }

    setGpsStatus('Acquiring GPS...');

    const onLocationSuccess = (pos) => {
      const { latitude, longitude } = pos.coords;
      setGpsStatus('');

      if (mapRef.current) {
        // Place or update a pulsing user location marker
        if (userMarkerRef.current) {
          userMarkerRef.current.setLatLng([latitude, longitude]);
        } else {
          userMarkerRef.current = L.circleMarker([latitude, longitude], {
            radius: 8,
            color: '#3b82f6',
            fillColor: '#60a5fa',
            fillOpacity: 0.9,
            weight: 2,
          })
            .bindPopup('<strong>Your Location</strong>')
            .addTo(mapRef.current);
        }

        mapRef.current.flyTo([latitude, longitude], 16, { animate: true, duration: 1.2 });
      }
    };

    // Tier 1: Try GPS with 20 second timeout + cached position support
    navigator.geolocation.getCurrentPosition(
      onLocationSuccess,
      (err) => {
        // Tier 2 Fallback: If hardware GPS times out, fallback to Wi-Fi / Cell tower location
        console.warn('GPS hardware timed out, falling back to network positioning...', err);
        setGpsStatus('Using cell/network location...');

        navigator.geolocation.getCurrentPosition(
          onLocationSuccess,
          (finalErr) => {
            setGpsStatus('');
            alert(
              'Location notice: ' +
                finalErr.message +
                '. If you are inside Messenger, please open this page in Chrome for full GPS access.'
            );
          },
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  };

  const openInChromeDirect = () => {
    const currentUrl = window.location.href.replace(/#.*$/, '');
    const intentUrl =
      'intent://' +
      currentUrl.replace(/^https?:\/\//, '') +
      '#Intent;scheme=https;package=com.android.chrome;end';
    window.location.href = intentUrl;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans p-3 sm:p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Messenger In-App Browser Warning Banner */}
        {isMessengerView && (
          <div className="bg-amber-950/80 border border-amber-600/70 text-amber-200 px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2 shadow">
            <span>
              ⚠️ Opened inside Messenger. Map performance and GPS are better in Google Chrome.
            </span>
            <button
              onClick={openInChromeDirect}
              className="bg-amber-600 hover:bg-amber-500 text-white font-semibold px-2.5 py-1 rounded text-[11px] whitespace-nowrap"
            >
              Open Chrome ↗
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-wide">
              Regional Network Advisory - Bicol
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              NAP Locator Dashboard •{' '}
              <span className="text-emerald-400">Synced {filteredNaps.length} records</span> •
              Updated {lastUpdated}
            </p>
          </div>

          {/* Locate Me GPS Button */}
          <button
            onClick={handleLocateMe}
            className="self-start sm:self-auto flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 active:scale-95 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow transition"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
              <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
            </svg>
            <span>{gpsStatus || 'Locate Me'}</span>
          </button>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded text-sm">
            {error}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-slate-800 border border-slate-700 p-3 sm:p-4 rounded-lg shadow">
            <p className="text-xs text-slate-400 font-semibold mb-1">LOADED NAP RECORDS</p>
            <p className="text-2xl sm:text-3xl font-bold text-white">
              {filteredNaps.length.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-800 border border-slate-700 p-3 sm:p-4 rounded-lg shadow">
            <p className="text-xs text-slate-400 font-semibold mb-1">UNIQUE LCP CODES</p>
            <p className="text-2xl sm:text-3xl font-bold text-white">
              {new Set(filteredNaps.map((n) => n.LCP_Code)).size.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-800 border border-slate-700 p-3 sm:p-4 rounded-lg shadow">
            <p className="text-xs text-slate-400 font-semibold mb-1">TOTAL PORTS (EST.)</p>
            <p className="text-2xl sm:text-3xl font-bold text-white">
              {filteredNaps
                .reduce((acc, curr) => acc + (parseInt(curr.Ports) || 16), 0)
                .toLocaleString()}
            </p>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="bg-slate-800 border border-slate-700 p-3 sm:p-4 rounded-lg shadow grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">
              SEARCH NAP / LCP / AREA
            </label>
            <div className="relative">
              <svg
                className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="e.g. BAC001, LP9, Daraga..."
                className="w-full bg-slate-900 border border-slate-700 text-white rounded py-2 pl-9 pr-8 text-sm focus:outline-none focus:border-blue-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">AREA</label>
            <select
              className="w-full bg-slate-900 border border-slate-700 text-white rounded py-2 px-3 text-sm focus:outline-none focus:border-blue-500"
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
            >
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">LCP CODE</label>
            <select
              className="w-full bg-slate-900 border border-slate-700 text-white rounded py-2 px-3 text-sm focus:outline-none focus:border-blue-500"
              value={selectedLcp}
              onChange={(e) => setSelectedLcp(e.target.value)}
            >
              {lcps.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Map & Table Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[600px]">
          {/* Map */}
          <div className="h-[58vh] min-h-[360px] lg:h-full lg:col-span-2 bg-slate-800 border border-slate-700 rounded-lg shadow overflow-hidden relative cursor-crosshair">
            {!loading && (
              <MapContainer
                ref={mapRef}
                center={[13.41, 123.41]}
                zoom={9}
                preferCanvas={true}
                style={{ height: '100%', width: '100%' }}
              >
                <MapResizer />
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <FastMarkers naps={filteredNaps} activeNapCode={activeNapCode} />
              </MapContainer>
            )}
          </div>

          {/* Table */}
          <div className="h-[48vh] lg:h-full bg-slate-800 border border-slate-700 rounded-lg shadow overflow-hidden flex flex-col">
            <div className="p-3 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
              <h3 className="text-sm font-semibold text-slate-300">NAP records</h3>
              <p className="text-xs text-slate-500">Showing top 500 max</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-900/50 text-xs uppercase text-slate-400 sticky top-0">
                  <tr>
                    <th className="px-3 py-2">NAP Code</th>
                    <th className="px-3 py-2">Ports</th>
                    <th className="px-3 py-2">Area</th>
                    <th className="px-3 py-2 text-right">Nav</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {filteredNaps.slice(0, 500).map((nap, idx) => {
                    const isSelected = activeNapCode === nap.NAP_Code;
                    return (
                      <tr
                        key={idx}
                        className={`hover:bg-slate-700/80 cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-sky-950/70 border-l-4 border-sky-400 font-medium'
                            : ''
                        }`}
                        onClick={() => setActiveNapCode(nap.NAP_Code)}
                      >
                        <td className="px-3 py-2 text-blue-400 hover:underline">
                          {nap.NAP_Code}
                        </td>
                        <td className="px-3 py-2">{nap.Ports}</td>
                        <td className="px-3 py-2 text-xs text-slate-400">{nap.Area}</td>
                        <td className="px-3 py-2 text-right">
                          <a
                            href={`https://www.google.com/maps/dir/?api=1&destination=${nap.Latitude},${nap.Longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-semibold text-sky-400 hover:underline"
                          >
                            Go ↗
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
