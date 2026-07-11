import React, { useState } from 'react';
import { useLocation } from 'wouter';
import { Clock, ChevronRight } from 'lucide-react';
import { getAllSessions, type HistorySession } from '@/lib/passportHistory';

export function PassportHistorySection() {
  const [, navigate] = useLocation();
  const [sessions] = useState<HistorySession[]>(() => getAllSessions().slice(0, 4));

  if (sessions.length === 0) return null;

  return (
    <section className="py-16 bg-gray-50 border-t border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Clock className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-primary">Recent Passport Sessions</h2>
              <p className="text-xs text-gray-400 mt-0.5">Saved in your browser — no re-upload needed</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/history')}
            className="flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            View all <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {sessions.map(session => {
            const allPhotos = session.rows.flatMap(r => r.slots);
            const date = new Date(session.createdAt).toLocaleDateString('en-IN', {
              day: 'numeric', month: 'short',
            });
            return (
              <button
                key={session.id}
                onClick={() => navigate(`/passport-size-maker/${session.id}`)}
                className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden hover:shadow-md hover:border-primary/30 transition-all text-left group"
              >
                <div className="p-2.5 bg-gray-50 flex gap-1.5">
                  {allPhotos.slice(0, 2).map((p, i) => (
                    <div key={i} className="flex-1 rounded-md overflow-hidden border border-gray-200" style={{ aspectRatio: '35/45', background: '#fff' }}>
                      <img
                        src={p.dataUrl} alt=""
                        className="w-full h-full object-cover block"
                        style={{ filter: p.brightness !== 100 ? `brightness(${p.brightness}%)` : undefined }}
                      />
                    </div>
                  ))}
                  {allPhotos.length > 2 && (
                    <div className="flex-1 rounded-md border border-gray-200 bg-gray-100 flex items-center justify-center text-[10px] text-gray-400 font-semibold" style={{ aspectRatio: '35/45' }}>
                      +{allPhotos.length - 2}
                    </div>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-xs text-gray-400">{date}</p>
                  <p className="text-sm font-semibold text-primary mt-0.5 group-hover:text-accent transition-colors">
                    {allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
