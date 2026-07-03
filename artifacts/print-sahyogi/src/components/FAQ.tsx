import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const faqs = [
  {
    question: "Is my data safe?",
    answer: "Yes, 100%. All PDF processing happens directly in your browser. We do not upload your Aadhaar to any servers, so your sensitive information never leaves your device."
  },
  {
    question: "What if my PDF is password protected?",
    answer: "No problem. Our tool will prompt you to enter the password (typically the first 4 letters of your name in capitals followed by your birth year, e.g., AMIT1990). The password is only used locally to decrypt the file for printing."
  },
  {
    question: "Which devices are supported?",
    answer: "Print Sahyogi works on any modern web browser across desktop, laptop, tablet, and mobile devices. For printing, we recommend using a computer connected to a printer."
  },
  {
    question: "What paper size should I use?",
    answer: "The layout generated is optimized for standard A4 paper size. When you click print, make sure your printer settings are set to A4."
  },
  {
    question: "Why is the Aadhaar cropped differently?",
    answer: "Our smart algorithm analyzes the PDF to find the exact boundaries of the ID cards (front and back) and crops away the unnecessary white space, giving you a clean, standard card size ready for lamination."
  }
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-24 bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-primary mb-4">Frequently Asked Questions</h2>
          <p className="text-lg text-gray-600">Everything you need to know about using Print Sahyogi.</p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div 
              key={index} 
              className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full px-6 py-5 text-left flex justify-between items-center focus:outline-none"
              >
                <span className="font-semibold text-gray-900 pr-4">{faq.question}</span>
                <ChevronDown 
                  className={`h-5 w-5 text-gray-400 transition-transform duration-300 ${
                    openIndex === index ? 'rotate-180 text-primary' : ''
                  }`} 
                />
              </button>
              <AnimatePresence>
                {openIndex === index && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="px-6 pb-5 text-gray-600 border-t border-gray-100 pt-4 leading-relaxed">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
