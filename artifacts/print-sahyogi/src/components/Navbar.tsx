import React, { useState } from 'react';
import { Menu, Printer, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks = [
    { name: 'Home', href: '#' },
    { name: 'Tools', href: '#tools' },
    { name: 'How it Works', href: '#how-it-works' },
    { name: 'FAQ', href: '#faq' },
  ];

  const scrollToSection = (href: string) => {
    setIsMobileMenuOpen(false);
    if (href === '#') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      const element = document.querySelector(href);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <nav className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex-shrink-0 flex items-center cursor-pointer" onClick={() => scrollToSection('#')}>
            <Printer className="h-8 w-8 text-primary" />
            <span className="ml-2 text-xl font-bold text-primary tracking-tight">EZONE Helper</span>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-8">
            {navLinks.map((link) => (
              <button
                key={link.name}
                onClick={() => scrollToSection(link.href)}
                className="text-sm font-medium text-gray-600 hover:text-primary transition-colors"
              >
                {link.name}
              </button>
            ))}
            <button
              onClick={() => scrollToSection('#tools')}
              className="bg-accent text-primary px-5 py-2 rounded-full font-semibold shadow-sm hover:shadow-md transition-all hover:bg-amber-400"
            >
              Try Free
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden items-center">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-gray-600 hover:text-primary p-2 focus:outline-none"
            >
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-b border-gray-100 overflow-hidden"
          >
            <div className="px-4 pt-2 pb-6 space-y-2">
              {navLinks.map((link) => (
                <button
                  key={link.name}
                  onClick={() => scrollToSection(link.href)}
                  className="block w-full text-left px-3 py-3 rounded-md text-base font-medium text-gray-700 hover:text-primary hover:bg-gray-50 transition-colors"
                >
                  {link.name}
                </button>
              ))}
              <div className="pt-2">
                <button
                  onClick={() => scrollToSection('#tools')}
                  className="w-full bg-accent text-primary px-5 py-3 rounded-full font-semibold shadow-sm hover:bg-amber-400 transition-colors"
                >
                  Try Free
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
