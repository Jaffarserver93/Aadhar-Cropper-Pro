import React from 'react';
import { Crop, FileCheck, LockKeyhole, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export function Features() {
  const features = [
    {
      icon: <LockKeyhole className="h-8 w-8 text-accent" />,
      title: 'Password Protected Support',
      description: 'Easily unlock your e-Aadhaar PDF securely within your browser.'
    },
    {
      icon: <Crop className="h-8 w-8 text-accent" />,
      title: 'Auto Crop & Padding',
      description: 'Smart algorithm detects the card boundaries and crops perfectly.'
    },
    {
      icon: <FileCheck className="h-8 w-8 text-accent" />,
      title: 'Print Ready Layout',
      description: 'Automatically formats front and back on a standard A4 page.'
    },
    {
      icon: <Zap className="h-8 w-8 text-accent" />,
      title: 'Lightning Fast',
      description: '100% local processing means no uploading, waiting, or data risks.'
    }
  ];

  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature, index) => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
              key={index}
              className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
            >
              <div className="bg-primary/5 w-16 h-16 rounded-xl flex items-center justify-center mb-6">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">{feature.title}</h3>
              <p className="text-gray-600 leading-relaxed">{feature.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
