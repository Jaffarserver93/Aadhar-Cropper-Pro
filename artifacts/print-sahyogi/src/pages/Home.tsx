import React from 'react';
import { Navbar } from '@/components/Navbar';
import { Hero } from '@/components/Hero';
import { Features } from '@/components/Features';
import { ToolsGrid } from '@/components/ToolsGrid';
import { HowItWorks } from '@/components/HowItWorks';
import { PrivacyPromise } from '@/components/PrivacyPromise';
import { FAQ } from '@/components/FAQ';
import { PassportHistorySection } from '@/components/PassportHistorySection';
import { Footer } from '@/components/Footer';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <Hero />
      <Features />
      <ToolsGrid />
      <HowItWorks />
      <PrivacyPromise />
      <FAQ />
      <PassportHistorySection />
      <Footer />
    </div>
  );
}
