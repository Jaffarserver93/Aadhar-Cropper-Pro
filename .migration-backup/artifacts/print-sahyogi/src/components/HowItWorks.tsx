import React from 'react';
import { Settings, Image, CheckCircle } from 'lucide-react';
import { motion } from 'framer-motion';

export function HowItWorks() {
  const steps = [
    {
      icon: <Image className="h-8 w-8 text-primary" />,
      title: "Upload Your PDF",
      desc: "Drag and drop your official e-Aadhaar PDF. It never leaves your device."
    },
    {
      icon: <Settings className="h-8 w-8 text-primary" />,
      title: "Auto Crop & Process",
      desc: "Enter your password if needed. We extract and perfectly crop the ID."
    },
    {
      icon: <CheckCircle className="h-8 w-8 text-primary" />,
      title: "Print Ready",
      desc: "Get an A4 formatted layout. Just hit print and you are done."
    }
  ];

  return (
    <section id="how-it-works" className="py-24 bg-white relative overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">How It Works</h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">Three simple steps to your perfect print. No technical skills required.</p>
        </div>

        <div className="relative">
          {/* Connecting line */}
          <div className="hidden md:block absolute top-12 left-[10%] right-[10%] h-0.5 bg-gray-100" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {steps.map((step, index) => (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.2 }}
                key={index}
                className="relative flex flex-col items-center text-center z-10"
              >
                <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center border-4 border-gray-50 shadow-sm mb-6 relative">
                  <div className="absolute inset-0 rounded-full border-2 border-accent border-dashed animate-[spin_10s_linear_infinite] opacity-20" />
                  {step.icon}
                  <div className="absolute -top-2 -right-2 w-8 h-8 bg-accent text-primary font-bold rounded-full flex items-center justify-center shadow-sm">
                    {index + 1}
                  </div>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-3">{step.title}</h3>
                <p className="text-gray-600 leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
