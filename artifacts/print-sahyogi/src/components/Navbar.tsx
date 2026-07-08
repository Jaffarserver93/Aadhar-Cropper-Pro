import React, { useState } from 'react';
import { Menu, Printer, X, LogIn, LogOut, Key, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, isAdmin, signOut } = useAuth();
  const [, navigate] = useLocation();

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

  const handleSignOut = () => {
    setIsMobileMenuOpen(false);
    signOut();
    navigate('/login');
  };

  return (
    <nav className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div
            className="flex-shrink-0 flex items-center cursor-pointer"
            onClick={() => navigate('/')}
          >
            <Printer className="h-8 w-8 text-primary" />
            <span className="ml-2 text-xl font-bold text-primary tracking-tight">EZONE Helper</span>
          </div>

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

            {isAdmin && (
              <button
                onClick={() => navigate('/code-generator')}
                className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-primary transition-colors"
              >
                <Key className="h-4 w-4" />
                Codes
              </button>
            )}

            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {user.username}
                </span>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 border border-gray-200 text-gray-600 px-4 py-1.5 rounded-full text-sm font-medium hover:bg-gray-50 transition-all"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={() => navigate('/login')}
                className="flex items-center gap-1.5 bg-primary text-white px-5 py-2 rounded-full font-semibold text-sm shadow-sm hover:shadow-md transition-all hover:bg-primary/90"
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </button>
            )}
          </div>

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

              {isAdmin && (
                <button
                  onClick={() => { setIsMobileMenuOpen(false); navigate('/code-generator'); }}
                  className="block w-full text-left px-3 py-3 rounded-md text-base font-medium text-gray-700 hover:text-primary hover:bg-gray-50 transition-colors"
                >
                  Code Generator
                </button>
              )}

              <div className="pt-2">
                {user ? (
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center justify-center gap-2 border border-gray-200 text-gray-700 px-5 py-3 rounded-full font-semibold transition-colors hover:bg-gray-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out ({user.username})
                  </button>
                ) : (
                  <button
                    onClick={() => { setIsMobileMenuOpen(false); navigate('/login'); }}
                    className="w-full flex items-center justify-center gap-2 bg-primary text-white px-5 py-3 rounded-full font-semibold hover:bg-primary/90 transition-colors"
                  >
                    <LogIn className="h-4 w-4" />
                    Sign in
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
