import React from 'react';
import { Navbar } from '@/components/Navbar';
import { Hero } from '@/components/Hero';
import { Features } from '@/components/Features';
import { AadhaarCropTool } from '@/components/AadhaarCropTool';
import { HowItWorks } from '@/components/HowItWorks';
import { PrivacyPromise } from '@/components/PrivacyPromise';
import { FAQ } from '@/components/FAQ';
import { Footer } from '@/components/Footer';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hide standard UI when printing */}
      <div className="print:hidden">
        <Navbar />
        <Hero />
        <Features />
      </div>
      
      {/* Main Tool Area */}
      <AadhaarCropTool />
      
      <div className="print:hidden">
        <HowItWorks />
        <PrivacyPromise />
        <FAQ />
        <Footer />
      </div>
    </div>
  );
}
