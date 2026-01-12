import React from 'react';
import { AppTab } from '../types';
import { MessageSquare, Mic2 } from 'lucide-react';

interface NavigationProps {
  currentTab: AppTab;
  onTabChange: (tab: AppTab) => void;
}

const Navigation: React.FC<NavigationProps> = ({ currentTab, onTabChange }) => {
  return (
    <div className="fixed bottom-6 left-0 right-0 flex justify-center z-50 pointer-events-none">
      <div className="pointer-events-auto bg-white/90 backdrop-blur-xl border border-white/40 shadow-dock rounded-2xl px-6 py-3 flex items-center gap-8 transition-all duration-300">
        <button
          onClick={() => onTabChange(AppTab.EXAM)}
          className={`group flex flex-col items-center justify-center space-y-1 transition-all duration-300 min-w-[64px] ${
            currentTab === AppTab.EXAM ? 'scale-105' : 'opacity-60 hover:opacity-100 hover:scale-105'
          }`}
        >
          <div className={`p-2 rounded-xl transition-colors duration-300 ${currentTab === AppTab.EXAM ? 'bg-ios-blue/10' : 'bg-transparent'}`}>
             <MessageSquare className={`w-6 h-6 transition-colors duration-300 ${currentTab === AppTab.EXAM ? 'text-ios-blue fill-ios-blue' : 'text-slate-600'}`} />
          </div>
          <span className={`text-[11px] font-semibold tracking-wide transition-colors ${currentTab === AppTab.EXAM ? 'text-ios-blue' : 'text-slate-500'}`}>
            模拟考试
          </span>
        </button>
        
        <div className="w-px h-8 bg-slate-200/60"></div>

        <button
          onClick={() => onTabChange(AppTab.SHADOWING)}
          className={`group flex flex-col items-center justify-center space-y-1 transition-all duration-300 min-w-[64px] ${
            currentTab === AppTab.SHADOWING ? 'scale-105' : 'opacity-60 hover:opacity-100 hover:scale-105'
          }`}
        >
           <div className={`p-2 rounded-xl transition-colors duration-300 ${currentTab === AppTab.SHADOWING ? 'bg-ios-blue/10' : 'bg-transparent'}`}>
             <Mic2 className={`w-6 h-6 transition-colors duration-300 ${currentTab === AppTab.SHADOWING ? 'text-ios-blue fill-ios-blue' : 'text-slate-600'}`} />
           </div>
          <span className={`text-[11px] font-semibold tracking-wide transition-colors ${currentTab === AppTab.SHADOWING ? 'text-ios-blue' : 'text-slate-500'}`}>
            影子跟读
          </span>
        </button>
      </div>
    </div>
  );
};

export default Navigation;