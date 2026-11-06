import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import Papa from 'papaparse';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default Leaflet icon paths
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Original fast canvas marker renderer (bypasses React Virtual DOM for lag-free rendering)
const FastMarkers = ({ naps, activeNapCode, onSelectNap }) => {
  const map = useMap();
  const markersRef = useRef({});
  const layerGroupRef = useRef(L.layerGroup());

  useEffect(() => {
    layerGroupRef.current.addTo(map);
    return () => {
      layerGroupRef.current.clearLayers();
    };
  }, [map]);

  useEffect(() => {
    layerGroupRef.current.clearLayers();
    markersRef.current = {};

    naps.forEach((nap) => {
      const lat = parseFloat(nap.Latitude || nap.LATITUDE);
      const lng = parseFloat(nap.Longitude || nap.LONGITUDE);
      if (isNaN(lat) || isNaN(lng)) return;

      const code = nap['NAP CODE'] || nap.nap_code || '';
      const isActive = activeNapCode && code === activeNapCode;

      const marker = L.circleMarker([lat, lng], {
        radius: isActive ? 8 : 5,
        color: isActive ? '#f59e0b' : '#0ea5e9',
        fillColor: isActive ? '#fbbf24' : '#38bdf8',
        fillOpacity: isActive ? 1 : 0.8,
        weight: isActive ? 2 : 1,
      });

      const popupContent = `
        <div style="font-family: inherit; font-size: 13px; color: #0f172a;">
          <div style="font-weight: 700; margin-bottom: 4px; color: #0284c7;">${code}</div>
          <div>Ports recorded: ${nap.PORTS || nap.Ports || nap.ports || 16}</div>
          <div>Area: ${nap.AREA || nap.Area || nap.area || ''}</div>
          <div style="margin-top: 4px; font-size: 11px; color: #64748b;">Coordinates: ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
          <div style="margin-top: 8px;">
            <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener noreferrer" style="color: #0284c7; font-weight: 600; text-decoration: none;">Open in Google Maps ↗</a>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);
      marker.on('click', () => {
        if (onSelectNap) onSelectNap(nap);
      });

      markersRef.current[code] = marker;
      layerGroupRef.current.addLayer(marker);
    });
  }, [naps, activeNapCode, map, onSelectNap]);

  return null;
};

export default function App() {
  const [naps, setNaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLcp, setSelectedLcp] = useState('ALL');
  const [activeNapCode, setActiveNapCode] = useState(null);
  const mapRef = useRef(null);

  // Auto-sync from Google Sheets NAP LOCATOR tab
  useEffect(() => {
    const csvUrl =
      'https://docs.google.com/spreadsheets/d/1DgYA7-nM4DoVg70YOEGlu4Au7nb7xNpdSzyW8BZFsOg/gviz/tq?tqx=out:csv&sheet=NAP%20LOCATOR';

    Papa.parse(csvUrl, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data) {
          const clean = results.data.filter((r) => {
            const lat = parseFloat(r.Latitude || r.LATITUDE);
            const lng = parseFloat(r.Longitude || r.LONGITUDE);
            return !isNaN(lat) && !isNaN(lng);
          });
          setNaps(clean);
        }
        setLoading(false);
      },
      error: () => setLoading(false),
    });
  }, []);

  // Unique LCPs for dropdown
  const lcps = React.useMemo(() => {
    const set = new Set();
    naps.forEach((n) => {
      const code = n['LCP CODE'] || n['LCP Code'] || n.lcp_code;
      if (code && code.trim()) set.add(code.trim());
    });
    return Array.from(set).sort();
  }, [naps]);

  // Filtering
  const filteredNaps = React.useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return naps.filter((n) => {
      const code = (n['NAP CODE'] || n.nap_code || '').toLowerCase();
      const lcp = (n['LCP CODE'] || n.lcp_code || '').trim();
      const area = (n.AREA || n.Area || n.area || '').toLowerCase();

      const matchesLcp = selectedLcp === 'ALL' || lcp === selectedLcp;
      const matchesSearch = !q || code.includes(q) || lcp.toLowerCase().includes(q) || area.includes(q);

      return matchesLcp && matchesSearch;
    });
  }, [naps, selectedLcp, searchTerm]);

  const handleSelectNap = (nap) => {
    const code = nap['NAP CODE'] || nap.nap_code;
    const lat = parseFloat(nap.Latitude || nap.LATITUDE);
    const lng = parseFloat(nap.Longitude || nap.LONGITUDE);

    setActiveNapCode(code);
    if (mapRef.current && !isNaN(lat) && !isNaN(lng)) {
      mapRef.current.flyTo([lat, lng], 17, { animate: true });
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Top Filter Bar */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
              SEARCH NAP / AREA / LCP
            </label>
            <input
              type="text"
              placeholder="e.g. LIA001, MTF BICOL..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="w-full sm:w-64">
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">
              LCP CODE
            </label>
            <select
              value={selectedLcp}
              onChange={(e) => setSelectedLcp(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
            >
              <option value="ALL">All LCP codes</option>
              {lcps.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Layout Grid: 60vh on mobile, side-by-side 600px on desktop */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[600px]">
          {/* Map */}
          <div className="h-[60vh] min-h-[350px] lg:h-full lg:col-span-2 bg-slate-800 border border-slate-700 rounded-lg shadow overflow-hidden relative">
            {!loading && (
              <MapContainer
                ref={mapRef}
                center={[13.41, 123.41]}
                zoom={9}
                preferCanvas={true}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                />
                <FastMarkers
                  naps={filteredNaps}
                  activeNapCode={activeNapCode}
                  onSelectNap={handleSelectNap}
                />
              </MapContainer>
            )}
          </div>

          {/* Records Table */}
          <div className="h-[50vh] lg:h-full bg-slate-800 border border-slate-700 rounded-lg shadow overflow-hidden flex flex-col">
            <div className="p-3 border-b border-slate-700 bg-slate-800/50">
              <h3 className="text-sm font-semibold text-slate-300">NAP records</h3>
              <p className="text-xs text-slate-500">Showing top 500 max</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-900/60 text-xs uppercase text-slate-400 sticky top-0">
                  <tr>
                    <th className="p
