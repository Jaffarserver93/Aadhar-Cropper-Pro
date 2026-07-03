import React from 'react';
import { Printer } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-primary text-blue-100 py-12 border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="col-span-1 md:col-span-1">
            <div className="flex items-center text-white mb-4">
              <Printer className="h-8 w-8 text-accent" />
              <span className="ml-2 text-xl font-bold tracking-tight">Print Sahyogi</span>
            </div>
            <p className="text-sm text-blue-200 max-w-xs">
              India's smart print companion for everyday documents. Fast, secure, and fully local.
            </p>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-4">Quick Links</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-accent transition-colors">Home</a></li>
              <li><a href="#tools" className="hover:text-accent transition-colors">Crop Tool</a></li>
              <li><a href="#how-it-works" className="hover:text-accent transition-colors">How It Works</a></li>
              <li><a href="#faq" className="hover:text-accent transition-colors">FAQ</a></li>
            </ul>
          </div>
          
          <div>
            <h4 className="text-white font-semibold mb-4">Legal</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-accent transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-accent transition-colors">Terms of Service</a></li>
            </ul>
            <div className="mt-6 flex items-center space-x-2 text-sm">
              <span className="flex h-2 w-2 rounded-full bg-green-400"></span>
              <span>All systems operational</span>
            </div>
          </div>
        </div>
        
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between">
          <p className="text-sm">
            &copy; {new Date().getFullYear()} Print Sahyogi. All rights reserved.
          </p>
          <p className="text-sm mt-4 md:mt-0 flex items-center">
            Made with <span className="text-accent mx-1 text-lg">♥</span> in India
          </p>
        </div>
      </div>
    </footer>
  );
}
