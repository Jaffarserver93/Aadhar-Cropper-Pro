import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, Trash2, Trash } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { getAllSessions, deleteSession, clearAllSessions, estimateStorageKB, type HistorySession } from '@/lib/passportHistory';

export default function HistoryPage() {
  const [, navigate] = useLocation();
  const [sessions, setSessions] = useState<HistorySession[]>(() => getAllSessions());
  const [storageKB] = useState(() => estimateStorageKB());

  const handleDelete = (id: string) => {
    deleteSession(id);
    setSessions(getAllSessions());
  };

  const handleClearAll = () => {
    if (!confirm('Delete all saved sessions? This cannot be undone.')) return;
    clearAllSessions();
    setSessions([]);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />

      <div className="bg-gray-50 border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm text-gray-500">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 hover:text-primary transition-colors font-medium">
            <ArrowLeft className="w-4 h-4" /> All Tools
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-primary font-semibold">Passport Photo History</span>
        </div>
      </div>

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-primary">Passport Photo History</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Saved locally in your browser · {sessions.length} session{sessions.length !== 1 ? 's' : ''} · ~{storageKB} KB used
            </p>
          </div>
          {sessions.length > 0 && (
            <button
              onClick={handleClearAll}
              className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 font-medium border border-red-200 hover:border-red-300 px-4 py-2 rounded-xl transition-colors"
            >
              <Trash className="w-4 h-4" /> Clear All
            </button>
          )}
        </div>
      </div>

      <section className="flex-1 py-8 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          {sessions.length === 0 ? (
            <div className="text-center py-24">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-lg font-semibold text-gray-400">No saved sessions</p>
              <p className="text-sm text-gray-400 mt-1">Sessions are saved automatically when you process a photo.</p>
              <button
                onClick={() => navigate('/passport-size-maker')}
                className="mt-6 bg-primary text-white px-6 py-2.5 rounded-xl font-semibold shadow-sm hover:bg-primary/90 transition-all text-sm"
              >
                Open Passport Maker
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sessions.map(session => {
                const totalCopies = session.photos.reduce((s, p) => s + p.copies, 0);
                const date = new Date(session.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                });
                const time = new Date(session.createdAt).toLocaleTimeString('en-IN', {
                  hour: '2-digit', minute: '2-digit',
                });
                return (
                  <div key={session.id} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    <div className="p-3 bg-gray-50 flex gap-2">
                      {session.photos.slice(0, 3).map((p, i) => (
                        <div key={i} className="flex-1 rounded-lg overflow-hidden border border-gray-200" style={{ aspectRatio: '35/45', background: '#fff' }}>
                          <img
                            src={p.dataUrl} alt=""
                            className="w-full h-full object-cover block"
                            style={{ filter: p.brightness !== 100 ? `brightness(${p.brightness}%)` : undefined }}
                          />
                        </div>
                      ))}
                      {session.photos.length > 3 && (
                        <div className="flex-1 rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center text-xs text-gray-400 font-semibold" style={{ aspectRatio: '35/45' }}>
                          +{session.photos.length - 3}
                        </div>
                      )}
                    </div>

                    <div className="px-4 py-3 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-gray-400">{date} · {time}</p>
                        <p className="text-sm font-semibold text-primary mt-0.5 truncate">
                          {session.photos.length} photo{session.photos.length !== 1 ? 's' : ''} · {totalCopies * 5} copies
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => navigate(`/passport-size-maker/${session.id}`)}
                          className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => handleDelete(session.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 hover:border-red-200 hover:bg-red-50 text-gray-400 hover:text-red-400 transition-colors"
                          aria-label="Delete session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
