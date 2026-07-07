import React from 'react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ArrowRight, Clock, Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface Tool {
  id: string;
  name: string;
  description: string;
  badge: string;
  route: string | null;
  available: boolean;
  icon: React.ReactNode;
}

const tools: Tool[] = [
  {
    id: 'aadhaar',
    name: 'Aadhaar Card',
    description: 'Auto-crop both sides, unlock password-protected PDFs, and get a print-ready A4 layout instantly.',
    badge: 'Available Now',
    route: '/aadhaar/crop',
    available: true,
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="hsl(222 72% 18%)" />
        <rect x="6" y="14" width="36" height="20" rx="3" fill="white" opacity="0.15" />
        <rect x="6" y="14" width="36" height="20" rx="3" stroke="white" strokeWidth="1.5" />
        <circle cx="16" cy="24" r="4" fill="#f59e0b" />
        <rect x="24" y="20" width="12" height="2" rx="1" fill="white" opacity="0.8" />
        <rect x="24" y="24" width="9" height="2" rx="1" fill="white" opacity="0.5" />
        <rect x="24" y="28" width="6" height="2" rx="1" fill="white" opacity="0.4" />
      </svg>
    ),
  },
  {
    id: 'voter',
    name: 'Voter ID Card',
    description: 'Auto-crop both sides of your Voter ID PDF and get a print-ready A4 layout instantly.',
    badge: 'Available Now',
    route: '/voter-id-card/crop',
    available: true,
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="hsl(222 72% 18%)" />
        <rect x="6" y="14" width="36" height="20" rx="3" fill="white" opacity="0.15" />
        <rect x="6" y="14" width="36" height="20" rx="3" stroke="white" strokeWidth="1.5" />
        <path d="M22 26l-3-3 1.4-1.4 1.6 1.6 4-4L27.4 20.6 22 26z" fill="#f59e0b" />
        <rect x="28" y="21" width="8" height="2" rx="1" fill="white" opacity="0.8" />
        <rect x="28" y="25" width="6" height="2" rx="1" fill="white" opacity="0.5" />
      </svg>
    ),
  },
  {
    id: 'pan',
    name: 'PAN Card',
    description: 'Precisely crop your PAN card PDF and arrange front and back for perfect printing.',
    badge: 'Coming Soon',
    route: null,
    available: false,
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="#64748b" />
        <rect x="6" y="14" width="36" height="20" rx="3" fill="white" opacity="0.1" />
        <rect x="6" y="14" width="36" height="20" rx="3" stroke="white" strokeWidth="1.5" opacity="0.5" />
        <rect x="10" y="19" width="10" height="10" rx="2" fill="white" opacity="0.3" />
        <rect x="24" y="20" width="14" height="2" rx="1" fill="white" opacity="0.4" />
        <rect x="24" y="24" width="10" height="2" rx="1" fill="white" opacity="0.3" />
        <rect x="24" y="28" width="7" height="2" rx="1" fill="white" opacity="0.2" />
      </svg>
    ),
  },
  {
    id: 'dl',
    name: 'Driving Licence',
    description: 'Format and print your Driving Licence in the correct proportions, ready for lamination.',
    badge: 'Coming Soon',
    route: null,
    available: false,
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="#64748b" />
        <rect x="6" y="14" width="36" height="20" rx="3" fill="white" opacity="0.1" />
        <rect x="6" y="14" width="36" height="20" rx="3" stroke="white" strokeWidth="1.5" opacity="0.5" />
        <circle cx="15" cy="28" r="4" fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" />
        <circle cx="15" cy="28" r="1.5" fill="white" opacity="0.4" />
        <path d="M19 28h14" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.3" />
        <rect x="24" y="18" width="12" height="2" rx="1" fill="white" opacity="0.4" />
        <rect x="24" y="22" width="8" height="2" rx="1" fill="white" opacity="0.3" />
      </svg>
    ),
  },
  {
    id: 'passport',
    name: 'Passport Size Photo',
    description: 'Remove background, crop to exact 35×45 mm, and print up to 30 photos on a single A4 sheet.',
    badge: 'Available Now',
    route: '/passport-size-maker',
    available: true,
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="hsl(222 72% 18%)" />
        <rect x="10" y="8" width="28" height="32" rx="3" fill="white" opacity="0.15" />
        <rect x="10" y="8" width="28" height="32" rx="3" stroke="white" strokeWidth="1.5" />
        <circle cx="24" cy="21" r="5" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
        <path d="M14 36c0-5.5 4.5-8 10-8s10 2.5 10 8" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
      </svg>
    ),
  },
  {
    id: 'rc',
    name: 'Vehicle RC',
    description: 'Extract and print your vehicle Registration Certificate in a compact, readable format.',
    badge: 'Coming Soon',
    route: null,
    available: false,
    icon: (
      <svg viewBox="0 0 48 48" fill="none" className="w-10 h-10" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="#64748b" />
        <rect x="6" y="16" width="36" height="16" rx="3" fill="white" opacity="0.1" />
        <rect x="6" y="16" width="36" height="16" rx="3" stroke="white" strokeWidth="1.5" opacity="0.5" />
        <circle cx="14" cy="32" r="4" fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" />
        <circle cx="34" cy="32" r="4" fill="none" stroke="white" strokeWidth="1.5" opacity="0.4" />
        <rect x="12" y="20" width="24" height="2" rx="1" fill="white" opacity="0.4" />
        <rect x="12" y="24" width="16" height="2" rx="1" fill="white" opacity="0.3" />
      </svg>
    ),
  },
];

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export function ToolsGrid() {
  const [, navigate] = useLocation();
  const { user, loading } = useAuth();
  const isLoggedIn = !loading && Boolean(user);

  return (
    <section id="tools" className="py-20 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-14">
          <span className="inline-block text-xs font-semibold tracking-widest text-accent uppercase mb-3">
            Document Tools
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-primary leading-tight">
            Pick Your Document
          </h2>
          <p className="mt-3 text-gray-500 max-w-lg mx-auto text-base">
            Select a document type to crop, format, and prepare a print-ready layout — all inside your browser.
          </p>
          {!loading && !isLoggedIn && (
            <div className="mt-4 inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium px-4 py-2 rounded-full">
              <Lock className="w-3.5 h-3.5" />
              Sign in to unlock the tools
            </div>
          )}
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.15 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {tools.map((tool) => (
            <motion.div key={tool.id} variants={cardVariants}>
              {tool.available && isLoggedIn ? (
                <button
                  onClick={() => navigate(tool.route!)}
                  className="group w-full text-left bg-white border-2 border-primary/10 hover:border-accent rounded-2xl p-6 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
                >
                  <ToolCardInner tool={tool} state="active" />
                </button>
              ) : tool.available && !isLoggedIn ? (
                <button
                  onClick={() => navigate('/login')}
                  className="group w-full text-left bg-white border-2 border-primary/10 hover:border-amber-400 rounded-2xl p-6 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:ring-offset-2 relative overflow-hidden"
                >
                  <ToolCardInner tool={tool} state="locked" />
                </button>
              ) : (
                <div className="w-full text-left bg-white border-2 border-gray-100 rounded-2xl p-6 opacity-60 cursor-not-allowed select-none">
                  <ToolCardInner tool={tool} state="soon" />
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function ToolCardInner({ tool, state }: { tool: Tool; state: 'active' | 'locked' | 'soon' }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between mb-4">
        <div className="shrink-0 relative">
          {tool.icon}
          {state === 'locked' && (
            <div className="absolute -bottom-1 -right-1 bg-amber-400 rounded-full p-0.5">
              <Lock className="w-2.5 h-2.5 text-white" />
            </div>
          )}
        </div>
        <span
          className={`text-xs font-semibold px-3 py-1 rounded-full ${
            state === 'active'
              ? 'bg-accent/10 text-accent'
              : state === 'locked'
              ? 'bg-amber-50 text-amber-600'
              : 'bg-gray-100 text-gray-400'
          }`}
        >
          {state === 'active' && tool.badge}
          {state === 'locked' && (
            <span className="flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Sign in to use
            </span>
          )}
          {state === 'soon' && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {tool.badge}
            </span>
          )}
        </span>
      </div>

      <h3
        className={`text-lg font-bold mb-2 ${
          state === 'active'
            ? 'text-primary group-hover:text-accent transition-colors'
            : state === 'locked'
            ? 'text-primary group-hover:text-amber-600 transition-colors'
            : 'text-gray-400'
        }`}
      >
        {tool.name}
      </h3>
      <p className="text-sm text-gray-500 leading-relaxed flex-1">{tool.description}</p>

      {state === 'active' && (
        <div className="mt-4 flex items-center text-sm font-semibold text-accent gap-1 group-hover:gap-2 transition-all">
          Open Tool <ArrowRight className="w-4 h-4" />
        </div>
      )}
      {state === 'locked' && (
        <div className="mt-4 flex items-center text-sm font-semibold text-amber-500 gap-1 group-hover:gap-2 transition-all">
          Sign in to unlock <ArrowRight className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
