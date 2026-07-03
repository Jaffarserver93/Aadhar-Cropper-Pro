import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';

export function PrivacyPromise() {
  return (
    <section className="bg-primary py-16 relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div className="absolute w-96 h-96 bg-accent/10 rounded-full blur-3xl -top-48 -left-48" />
        <div className="absolute w-96 h-96 bg-accent/10 rounded-full blur-3xl -bottom-48 -right-48" />
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 md:p-12 text-center border border-white/20"
        >
          <div className="mx-auto w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-accent/20">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">Our Privacy Promise</h2>
          <p className="text-xl text-blue-100 mb-8 leading-relaxed">
            Your Aadhaar contains sensitive information. We built Print Sahyogi so that <strong>no data ever leaves your device.</strong>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="bg-primary/50 p-4 rounded-xl border border-white/10">
              <h4 className="text-white font-semibold mb-2">100% Local</h4>
              <p className="text-blue-200 text-sm">All processing happens directly inside your web browser.</p>
            </div>
            <div className="bg-primary/50 p-4 rounded-xl border border-white/10">
              <h4 className="text-white font-semibold mb-2">Zero Uploads</h4>
              <p className="text-blue-200 text-sm">We don't have servers. We can't see, save, or share your files.</p>
            </div>
            <div className="bg-primary/50 p-4 rounded-xl border border-white/10">
              <h4 className="text-white font-semibold mb-2">Auto Cleared</h4>
              <p className="text-blue-200 text-sm">Once you close the tab, your document is completely gone.</p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
