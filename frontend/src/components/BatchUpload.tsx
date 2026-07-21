import React, { useState } from 'react';
import { fageApi } from '../services/api';

export const BatchUpload: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fageApi.batchScore(file);
      setResult(res);
    } catch (err) {
      console.error(err);
      setResult({ error: 'Failed to upload and process file' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded-xl p-6 shadow-sm transition-all">
      <h3 className="text-sm font-bold uppercase tracking-wider text-on-surface mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        Batch CSV Scoring
      </h3>
      <div className="flex items-center gap-4">
        <input 
          type="file" 
          accept=".csv"
          onChange={handleFileChange}
          className="block w-full text-sm text-on-surface-variant file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-bold file:bg-surface-container file:text-primary hover:file:opacity-80 transition-all cursor-pointer"
        />
        <button 
          onClick={handleUpload}
          disabled={!file || loading}
          className="px-6 py-2 bg-primary text-on-primary hover:opacity-90 rounded-lg font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95"
        >
          {loading ? 'Processing...' : 'Upload'}
        </button>
      </div>
      {result && (
        <div className="mt-4 p-4 bg-surface rounded border border-outline-variant max-h-48 overflow-y-auto">
          <pre className="text-xs text-on-surface font-mono">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
