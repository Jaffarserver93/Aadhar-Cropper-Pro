import React, { useEffect } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { VoterCropTool } from '@/components/VoterCropTool';

export default function VoterIdCropPage() {
  const [, navigate] = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="print:hidden">
        <Navbar />
      </div>

      {/* Breadcrumb / back bar */}
      <div className="print:hidden bg-gray-50 border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-2 text-sm text-gray-500">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 hover:text-primary transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            All Tools
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-primary font-semibold">Voter ID Crop &amp; Print</span>
        </div>
      </div>

      {/* Page header */}
      <div className="print:hidden bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-primary">
            Voter ID Crop &amp; Print
          </h1>
          <p className="text-gray-500 mt-1 text-sm sm:text-base">
            Upload your Voter ID PDF, auto-crop both sides, and get a print-ready A4 layout — all in your browser.
          </p>
        </div>
      </div>

      {/* Tool */}
      <div className="flex-1">
        <VoterCropTool />
      </div>

      <div className="print:hidden">
        <Footer />
      </div>
    </div>
  );
}
