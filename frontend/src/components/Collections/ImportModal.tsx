import { useState, useRef } from 'react';
import { useAppStore } from '../../store';
import { X, Upload, FileJson, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ImportModal() {
  const { importCollection, setShowImportModal } = useAppStore();
  const [format, setFormat] = useState<'postman' | 'apix' | 'openapi'>('postman');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setLoading(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importCollection(data, format);
      toast.success(`Collection imported: ${data.info?.name || data.name || file.name}`);
      setShowImportModal(false);
    } catch (err) {
      setError('Failed to parse file: ' + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={() => setShowImportModal(false)}
    >
      <div
        className="bg-app-panel border border-app-border rounded-xl shadow-2xl w-[500px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-app-border">
          <h2 className="font-semibold text-app-text flex items-center gap-2">
            <Upload size={16} className="text-app-accent" />
            Import Collection
          </h2>
          <button
            onClick={() => setShowImportModal(false)}
            className="p-1.5 hover:bg-app-hover rounded text-app-muted hover:text-app-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Format selector */}
          <div>
            <label className="block text-xs text-app-muted mb-2">Format</label>
            <div className="flex gap-2">
              {(['postman', 'apix', 'openapi'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 py-2 text-sm rounded border transition-colors capitalize ${
                    format === f
                      ? 'border-app-accent bg-app-accent/10 text-app-text'
                      : 'border-app-border text-app-muted hover:border-app-active hover:text-app-text'
                  }`}
                >
                  {f === 'postman' ? 'Postman v2.1' : f === 'apix' ? 'APIK / Bruno' : 'OpenAPI (beta)'}
                </button>
              ))}
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragging
                ? 'border-app-accent bg-app-accent/10'
                : 'border-app-border hover:border-app-accent/50 hover:bg-app-hover/50'
            }`}
          >
            <FileJson size={32} className="mx-auto mb-3 text-app-muted opacity-60" />
            <p className="text-sm text-app-text">Drop a JSON file here</p>
            <p className="text-xs text-app-muted mt-1">or click to browse</p>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-900/30 border border-red-800/50 rounded p-3 text-red-300 text-xs">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {loading && (
            <div className="text-center text-sm text-app-muted">Importing…</div>
          )}
        </div>
      </div>
    </div>
  );
}
