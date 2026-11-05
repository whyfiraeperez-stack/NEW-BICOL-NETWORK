import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';

// --- GOOGLE SHEETS CSV EXPORT LINK ---
// Updated to use the gviz endpoint pointing explicitly to the "NAP LOCATOR" sheet. 
// This bypasses common CORS blocks and targets the exact tab.
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1DgYA7-nM4DoVg70YOEGlu4Au7nb7xNpdSzyW8BZFsOg/gviz/tq?tqx=out:csv&sheet=NAP%20LOCATOR';

// --- MOCK FALLBACK DATA ---
const MOCK_DATA = [
  { "NAP code": "BAC001 LP8 NP1-2", "Ports": 16, "Area": "LA MEDALLA", "Latitude": 13.55, "Longitude": 123.35, "LCP": "BAC001 LP8" },
  { "NAP code": "BAC001 LP7 NP7-8", "Ports": 16, "Area": "BAAO TO BULA MTF", "Latitude": 13.45, "Longitude": 123.36, "LCP": "BAC001 LP7" },
  { "NAP code": "NAG005 LP1 NP1-2", "Ports": 8, "Area": "NAGA CITY CBD", "Latitude": 13.62, "Longitude": 123.18, "LCP": "NAG005 LP1" },
  { "NAP code": "LEG012 LP3 NP3-4", "Ports": 16, "Area": "LEGAZPI PORT", "Latitude": 13.14, "Longitude": 123.75, "LCP": "LEG012 LP3" },
  { "NAP code": "SOR002 LP1 NP1-2", "Ports": 8, "Area": "SORSOGON CITY PIOT", "Latitude": 12.97, "Longitude": 124.00, "LCP": "SOR002 LP1" },
  { "NAP code": "MAS001 LP2 NP1-2", "Ports": 16, "Area": "MASBATE IBINGAY", "Latitude": 12.37, "Longitude": 123.62, "LCP": "MAS001 LP2" },
];

// --- CUSTOM CSV PARSER (Replaces PapaParse) ---
const parseCSV = (rawStr) => {
  const str = rawStr.replace(/\r/g, ''); // Clean carriage returns
  const result = [];
  let row = [];
  let inQuotes = false;
  let val = '';
  for (let i = 0; i < str.length; i++) {
    let char = str[i];
    if (char === '"' && str[i + 1] === '"') {
      val += '"'; i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(val); val = '';
    } else if (char === '\n' && !inQuotes) {
      row.push(val); result.push(row);
      row = []; val = '';
    } else {
      val += char;
    }
  }
  row.push(val);
  result.push(row);

  const headers = result[0].map(h => h.trim());
  return result.slice(1).filter(r => r.length === headers.length || r.some(c => c !== '')).map(r => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = (r[i] || '').trim());
    return obj;
  });
};

// --- VANILLA LEAFLET MAP COMPONENT (Bypasses react-leaflet for Preview compatibility) ---
const LeafletMap = ({ naps }) => {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const markersLayer = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Dynamically inject Leaflet CSS & JS via CDN
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => setIsLoaded(true);
      document.head.appendChild(script);
    } else {
      if (window.L) setIsLoaded(true);
      else document.getElementById('leaflet-js').addEventListener('load', () => setIsLoaded(true));
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !mapRef.current) return;

    if (!mapInstance.current) {
      mapInstance.current = window.L.map(mapRef.current, { zoomControl: false }).setView([13.5, 123.3], 9);
      
      <TileLayer
  url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
  attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
/>

      markersLayer.current = window.L.layerGroup().addTo(mapInstance.current);
    }

    if (markersLayer.current) {
      markersLayer.current.clearLayers();
      
      const createCustomPin = (color = '#06b6d4') => window.L.divIcon({
        className: 'custom-pin',
        html: `<div style="width: 14px; height: 14px; background-color: ${color}; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${color};"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      naps.forEach(nap => {
        if (nap.Latitude && nap.Longitude) {
          const marker = window.L.marker([nap.Latitude, nap.Longitude], { icon: createCustomPin() });
          marker.bindPopup(`
            <div style="background:#1e293b; color:#e2e8f0; padding:12px; font-family:sans-serif; min-width:180px;">
              <p style="font-size:10px; color:#94a3b8; font-weight:bold; margin:0 0 6px 0; text-transform:uppercase;">NAP Details</p>
              <h4 style="color:#ffffff; margin:0 0 10px 0; font-size:16px;">${nap['NAP code']}</h4>
              <p style="margin:4px 0; font-size:12px;"><span style="color:#64748b;">Area:</span> ${nap.Area}</p>
              <p style="margin:4px 0; font-size:12px;"><span style="color:#64748b;">LCP:</span> ${nap.LCP}</p>
              <p style="margin:4px 0; font-size:12px;"><span style="color:#64748b;">Ports:</span> <span style="color:#22d3ee; font-weight:bold;">${nap.Ports}</span></p>
            </div>
          `);
          markersLayer.current.addLayer(marker);
        }
      });
    }
  }, [isLoaded, naps]);

  return <div ref={mapRef} style={{ height: '100%', width: '100%', background: '#0b1120', zIndex: 0 }} />;
};

export default function RegionalAdvisoryDashboard() {
  const [naps, setNaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncTime, setSyncTime] = useState('');
  const [error, setError] = useState(null);

  // Filters state
  const [search, setSearch] = useState('');
  const [selectedArea, setSelectedArea] = useState('All');
  const [selectedLcp, setSelectedLcp] = useState('All');
  const [selectedPort, setSelectedPort] = useState('All');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await fetch(SHEET_CSV_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();
        
        const data = parseCSV(text);
        let parsedData = data
          .filter(row => row && (row['NAP code'] || row['NAP CODE'] || row['NAP_CODE'])) 
          .map(row => ({
            "NAP code": row['NAP code'] || row['NAP CODE'] || row['NAP_CODE'] || 'Unknown',
            "Ports": parseInt(row['Ports'] || row['PORT COUNT'] || row['PORTS']) || 16,
            "Area": row['Area'] || row['AREA'] || 'Unknown',
            "Latitude": parseFloat(row['Latitude'] || row['LATITUDE']) || (13.5 + (Math.random() * 0.5 - 0.25)),
            "Longitude": parseFloat(row['Longitude'] || row['LONGITUDE']) || (123.3 + (Math.random() * 0.5 - 0.25)),
            "LCP": row['LCP CODE'] || row['LCP'] || (row['NAP code'] ? row['NAP code'].split(' ').slice(0, 2).join(' ') : 'Unknown')
          }));

        if (parsedData.length === 0) {
          parsedData = MOCK_DATA;
          setError("No NAP data found in the sheet. Showing cached preview.");
        } else {
          setError(null); // Clear errors on successful fetch
        }

        setNaps(parsedData);
        setSyncTime(new Date().toLocaleTimeString());
        setLoading(false);
      } catch (err) {
        console.error("Error fetching CSV:", err);
        setError("Failed to fetch live data (Ensure sheet is 'Anyone with link can view'). Showing cached preview.");
        setNaps(MOCK_DATA);
        setSyncTime(new Date().toLocaleTimeString());
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 300000); // 5 mins
    return () => clearInterval(interval);
  }, []);

  const filteredNaps = useMemo(() => {
    return naps.filter(nap => {
      const searchMatch = 
        nap['NAP code']?.toLowerCase().includes(search.toLowerCase()) || 
        nap.Area?.toLowerCase().includes(search.toLowerCase()) ||
        nap.LCP?.toLowerCase().includes(search.toLowerCase());
      
      const areaMatch = selectedArea === 'All' || nap.Area === selectedArea;
      const lcpMatch = selectedLcp === 'All' || nap.LCP === selectedLcp;
      const portMatch = selectedPort === 'All' || String(nap.Ports) === String(selectedPort);

      return searchMatch && areaMatch && lcpMatch && portMatch;
    });
  }, [naps, search, selectedArea, selectedLcp, selectedPort]);

  const uniqueAreas = useMemo(() => [...new Set(naps.map(n => n.Area))].filter(Boolean).sort(), [naps]);
  const uniqueLcps = useMemo(() => [...new Set(naps.map(n => n.LCP))].filter(Boolean).sort(), [naps]);
  const uniquePorts = useMemo(() => [...new Set(naps.map(n => n.Ports))].filter(Boolean).sort((a,b)=>a-b), [naps]);

  const metrics = useMemo(() => {
    return {
      totalNaps: naps.length,
      uniqueLcps: uniqueLcps.length,
      totalPorts: naps.reduce((acc, curr) => acc + (curr.Ports || 0), 0),
      activeAreas: uniqueAreas.length
    };
  }, [naps, uniqueLcps, uniqueAreas]);

  return (
    <div className="min-h-screen bg-[#0b1120] text-slate-300 font-sans">
      <header className="bg-[#0f172a] border-b border-slate-800 px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <Server className="text-cyan-500" size={26} />
              Regional Network Advisory - Bicol
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-400">NAP Locator Dashboard</span>
              <span className="text-xs text-slate-500">•</span>
              {loading ? (
                <span className="text-xs text-cyan-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Syncing from Google Sheets...</span>
              ) : (
                <span className="text-xs text-emerald-400 flex items-center gap-1"><Activity size={12} /> Synced {metrics.totalNaps.toLocaleString()} records - Updated {syncTime}</span>
              )}
            </div>
            {error && <p className="text-xs text-amber-500 mt-1">{error}</p>}
          </div>
          <button className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 transition px-4 py-2 rounded-lg text-sm text-slate-200 border border-slate-700">
            <ArrowDownToLine size={16} />
            Manual Import
          </button>
        </div>
      </header>

      <main className="p-6 max-w-[1600px] mx-auto space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-lg">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Loaded NAP Records</p>
            <h2 className="text-3xl font-bold text-white mt-1">{metrics.totalNaps.toLocaleString()}</h2>
          </div>
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-lg">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Unique LCP Codes</p>
            <h2 className="text-3xl font-bold text-white mt-1">{metrics.uniqueLcps.toLocaleString()}</h2>
          </div>
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-lg">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Total Active Ports</p>
            <h2 className="text-3xl font-bold text-white mt-1">{metrics.totalPorts.toLocaleString()}</h2>
          </div>
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-lg">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Service Areas</p>
            <h2 className="text-3xl font-bold text-white mt-1">{metrics.activeAreas.toLocaleString()}</h2>
          </div>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 shadow-lg grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="w-full">
            <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">Search NAP / LCP / Area</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500" size={16} />
              <input 
                type="text" 
                placeholder="e.g. BAC001 LP9 NP7-8"
                className="w-full bg-[#1e293b] border border-slate-700 text-sm rounded-lg pl-10 pr-4 py-2 focus:ring-1 focus:ring-cyan-500 outline-none text-white transition"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="w-full">
            <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">Area</label>
            <select 
              className="w-full bg-[#1e293b] border border-slate-700 text-sm rounded-lg px-4 py-2 focus:ring-1 focus:ring-cyan-500 outline-none text-white appearance-none"
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
            >
              <option value="All">All areas</option>
              {uniqueAreas.map(area => <option key={area} value={area}>{area}</option>)}
            </select>
          </div>
          <div className="w-full">
            <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">LCP Code</label>
            <select 
              className="w-full bg-[#1e293b] border border-slate-700 text-sm rounded-lg px-4 py-2 focus:ring-1 focus:ring-cyan-500 outline-none text-white appearance-none"
              value={selectedLcp}
              onChange={(e) => setSelectedLcp(e.target.value)}
            >
              <option value="All">All LCP codes</option>
              {uniqueLcps.map(lcp => <option key={lcp} value={lcp}>{lcp}</option>)}
            </select>
          </div>
          <div className="w-full">
            <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block mb-1">Port Count</label>
            <select 
              className="w-full bg-[#1e293b] border border-slate-700 text-sm rounded-lg px-4 py-2 focus:ring-1 focus:ring-cyan-500 outline-none text-white appearance-none"
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
            >
              <option value="All">All counts</option>
              {uniquePorts.map(port => <option key={port} value={port}>{port}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[700px]">
          <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col relative">
            <div className="absolute top-4 left-4 z-[400] bg-slate-900/90 border border-slate-700 backdrop-blur px-4 py-2 rounded-lg pointer-events-none shadow-xl">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MapPin size={16} className="text-cyan-400" />
                NAP Map View
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5">Select a marker for details</p>
            </div>
            
            <LeafletMap naps={filteredNaps} />
            
          </div>

          <div className="lg:col-span-1 bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-[#0f172a]">
              <h3 className="text-sm font-bold text-white">NAP Records</h3>
              <span className="text-[10px] text-slate-500">{filteredNaps.length} records • showing top 500</span>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <table className="w-full text-left text-xs whitespace-nowrap">
                <thead className="bg-[#1e293b] text-slate-400 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-700">
                  <tr>
                    <th className="px-4 py-3 font-semibold">NAP code</th>
                    <th className="px-4 py-3 font-semibold text-center">Ports</th>
                    <th className="px-4 py-3 font-semibold">Area</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {filteredNaps.slice(0, 500).map((nap, idx) => (
                    <tr key={`table-${idx}`} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-cyan-400 font-medium">{nap['NAP code']}</td>
                      <td className="px-4 py-3 text-slate-300 text-center">{nap.Ports}</td>
                      <td className="px-4 py-3 text-slate-300">
                        <span className="block truncate max-w-[120px]" title={nap.Area}>{nap.Area}</span>
                      </td>
                    </tr>
                  ))}
                  {filteredNaps.length === 0 && (
                    <tr>
                      <td colSpan="3" className="px-4 py-12 text-center text-slate-500">
                        No records match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #475569; }
        .leaflet-popup-content-wrapper { background: transparent !important; padding: 0 !important; box-shadow: none !important; }
        .leaflet-popup-tip { background: #1e293b !important; border: 1px solid #334155; }
        .leaflet-popup-content { margin: 0 !important; }
      `}} />
    </div>
  );
}
