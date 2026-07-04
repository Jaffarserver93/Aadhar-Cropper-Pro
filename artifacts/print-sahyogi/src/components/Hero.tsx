import React from 'react';
import { ArrowRight, FileText, Lock, Printer } from 'lucide-react';
import { motion } from 'framer-motion';

export function Hero() {
  const scrollToTool = () => {
    document.querySelector('#tools')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="relative overflow-hidden bg-primary pt-16 pb-24 sm:pt-24 sm:pb-32 lg:pb-40">
      {/* Background patterns */}
      <div className="absolute inset-0 z-0 opacity-10">
        <svg className="absolute left-0 top-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <pattern id="grid-pattern" width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M 8 0 L 0 0 0 8" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
          <rect width="100" height="100" fill="url(#grid-pattern)" />
        </svg>
        <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-primary to-transparent" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center space-x-2 bg-white/10 rounded-full px-4 py-1.5 mb-8 text-sm font-medium border border-white/20"
        >
          <span className="flex h-2 w-2 rounded-full bg-accent"></span>
          <span>100% Secure & Local Processing</span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6"
        >
          Print Your Aadhaar,<br className="hidden md:block" /> the <span className="text-accent">Smart Way</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="text-lg md:text-xl text-blue-100 max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Upload your PDF, unlock it, and get an auto-cropped, print-ready A4 layout in seconds. Zero data stored. Pure convenience.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto"
        >
          <button
            onClick={scrollToTool}
            className="flex items-center justify-center space-x-2 bg-accent text-primary px-8 py-4 rounded-full font-bold text-lg hover:bg-amber-400 hover:scale-105 transition-all shadow-xl shadow-accent/20"
          >
            <span>Crop PVC Card's Now</span>
            <ArrowRight className="h-5 w-5" />
          </button>
        </motion.div>

        {/* Feature quick icons */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-16 grid grid-cols-2 md:grid-cols-3 gap-8 text-sm text-blue-200"
        >
          <div className="flex flex-col items-center gap-2">
            <FileText className="h-6 w-6 text-accent" />
            <span>PDF Upload</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Lock className="h-6 w-6 text-accent" />
            <span>Password Support</span>
          </div>
          <div className="flex flex-col items-center gap-2 col-span-2 md:col-span-1">
            <Printer className="h-6 w-6 text-accent" />
            <span>Print Ready A4</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
