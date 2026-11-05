import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import Papa from 'papaparse';
import { Search } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

export default function App() {
  const [naps, setNaps] = useState([]);
  const [filteredNaps, setFilteredNaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArea, setSelectedArea] = useState("All areas");
  const [selectedLcp, setSelectedLcp] = useState("All LCP codes");

  const areas = ["All areas", ...new Set(naps.map(n => n.Area).filter(Boolean))].sort();
  const lcps = ["All LCP codes", ...new Set(naps.map(n => n.LCP_Code).filter(Boolean))].sort();

  const SHEET_URL = "https://docs.google.com/spreadsheets/d/1DgYA7-nM4DoVg70YOEGlu4Au7nb7xNpdSzyW8BZFsOg/gviz/tq?tqx=out:csv&sheet=NAP%20LOCATOR";

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(SHEET_URL);
        const csvText = await response.text();
        
        Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const parsedData = results.data.map(row => {
              const getVal = (keys) => {
                for(let k of keys) {
                  if(row[k]) return row[k];
                  const foundKey = Object.keys(row).find(rk => rk.toLowerCase().trim() === k.toLowerCase());
                  if(foundKey) return row[foundKey];
                }
                return "";
              };

              const napCode = getVal(["NAP code", "NAP CODE", "NAP_CODE"]);
              const lcpMatch = napCode ? napCode.split(" NP")[0] : "";

              return {
                NAP_Code: napCode,
                Ports: getVal(["Ports", "PORTS", "PORT_COUNT", "Port Count"]),
                Area: getVal(["Area", "AREA"]),
                Latitude: parseFloat(getVal(["Latitude", "LATITUDE", "Lat"])),
                Longitude: parseFloat(getVal(["Longitude", "LONGITUDE", "Long", "Lng"])),
                LCP_Code: lcpMatch
              };
            }).filter(n => !isNaN(n.Latitude) && !isNaN(n.Longitude));

            setNaps(parsedData);
            setFilteredNaps(parsedData);
            setLastUpdated(new Date().toLocaleTimeString());
            setLoading(false);
          },
          error: (err) => {
            setError("Failed to parse CSV data.");
            setLoading(false);
          }
        });
      } catch (err) {
        setError("Failed to connect to Google Sheets. Ensure it is set to 'Anyone with the link can view'.");
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 300000); 
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let result = naps;
    if (searchQuery) {
      result = result.filter(n => n.NAP_Code.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (selectedArea !== "All areas") {
      result = result.filter(n => n.Area === selectedArea);
    }
    if (selectedLcp !== "All LCP codes") {
      result = result.filter(n => n.LCP_Code === selectedLcp);
    }
    setFilteredNaps(result);
  }, [searchQuery, selectedArea, selectedLcp, naps]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 font-sans p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide">Regional Network Advisory - Bicol</h1>
            <p className="text-sm text-slate-400">
              NAP Locator Dashboard • <span className="text-emerald-400">Synced {filteredNaps.length} records</span> • Updated {lastUpdated}
            </p>
          </div>
        </div>

        {error && <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded">{error}</div>}

        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-800 border border-slate-700 p-4 rounded-lg shadow">
            <p className="text-xs text-slate-400 font-semibold mb-1">LOADED NAP RECORDS</p>
            <p className="text-3xl font-bold text-white">{filteredNaps.length.toLocaleString()}</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 p-4 rounded-lg shadow">
            <p className="text-xs text-slate-400 font-semibold mb-1">UNIQUE LCP CODES</p>
            <p className="text-3xl font-bold text-white">
              {new Set(filteredNaps.map(n => n.LCP_Code)).size.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-800 border border-slate-700 p-4 rounded-lg shadow">
            <p className="text-xs text-slate-400 font-semibold mb-1">TOTAL PORTS (EST.)</p>
            <p className="text-3xl font-bold text-white">
              {filteredNaps.reduce((acc, curr) => acc + (parseInt(curr.Ports) || 16), 0).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-slate-800 border border-slate-700 p-4 rounded-lg shadow grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">SEARCH NAP / LCP / AREA</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input 
                type="text"
                placeholder="e.g. BAC001 LP9"
                className="w-full bg-slate-900 border border-slate-700 text-white rounded py-2 pl-9 pr-3 focus:outline-none focus:border-blue-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">AREA</label>
            <select 
              className="w-full bg-slate-900 border border-slate-700 text-white rounded py-2 px-3 focus:outline-none focus:border-blue-500"
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value)}
            >
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-semibold mb-1 block">LCP CODE</label>
            <select 
              className="w-full bg-slate-900 border border-slate-700 text-white rounded py-2 px-3 focus:outline-none focus:border-blue-500"
              value={selectedLcp}
              onChange={(e) => setSelectedLcp(e.target.value)}
            >
              {lcps.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>

        {/* Map and Table */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[600px]">
          <div className="lg:col-span-2 bg-slate-800 border border-slate-700 rounded-lg shadow overflow-hidden relative">
            {!loading && (
              <MapContainer center={[13.41, 123.41]} zoom={9} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                  attribution='&copy; Esri'
                />
                {filteredNaps.map((nap, idx) => (
                  <CircleMarker 
                    key={idx}
                    center={[nap.Latitude, nap.Longitude]}
                    radius={5}
                    pathOptions={{ color: '#3b82f6', fillColor: '#60a5fa', fillOpacity: 0.7 }}
                  >
                    <Popup>
                      <div className="text-slate-900 font-sans">
                        <strong className="block text-sm mb-1">{nap.NAP_Code}</strong>
                        <p className="text-xs m-0">Area: {nap.Area}</p>
                        <p className="text-xs m-0">Ports: {nap.Ports}</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            )}
          </div>
          
          <div className="bg-slate-800 border border-slate-700 rounded-lg shadow overflow-hidden flex flex-col">
            <div className="p-3 border-b border-slate-700 bg-slate-800/50">
              <h3 className="text-sm font-semibold text-slate-300">NAP records</h3>
              <p className="text-xs text-slate-500">Showing top 500 max</p>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-900/50 text-xs uppercase text-slate-400 sticky top-0">
                  <tr>
                    <th className="px-3 py-2">NAP Code</th>
                    <th className="px-3 py-2">Area</th>
                    <th className="px-3 py-2">Ports</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {filteredNaps.slice(0, 500).map((nap, idx) => (
                    <tr key={idx} className="hover:bg-slate-700/30">
                      <td className="px-3 py-2 font-medium">{nap.NAP_Code}</td>
                      <td className="px-3 py-2">{nap.Area}</td>
                      <td className="px-3 py-2">{nap.Ports}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
