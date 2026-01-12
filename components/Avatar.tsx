import React from 'react';
import { Mic, Volume2 } from 'lucide-react';

interface AvatarProps {
  isSpeaking: boolean;
  isListening: boolean;
}

const Avatar: React.FC<AvatarProps> = ({ isSpeaking, isListening }) => {
  return (
    <div className="relative flex flex-col items-center justify-center">
      {/* Outer Glow Ring - Active when speaking */}
      <div className={`absolute w-40 h-40 rounded-full transition-all duration-500 ${isSpeaking ? 'bg-ios-blue/20 scale-125 blur-2xl' : 'bg-transparent scale-100'}`}></div>
      
      {/* Avatar Container */}
      <div className="relative w-32 h-32 rounded-full overflow-hidden ring-4 ring-white shadow-2xl bg-gradient-to-br from-slate-100 to-slate-200 z-10">
        <img 
            src="https://picsum.photos/400/400?grayscale" 
            alt="AI Examiner" 
            className="w-full h-full object-cover"
        />
        
        {/* Status Overlay */}
        <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
             {isSpeaking && (
                 <div className="absolute bottom-2 bg-white/90 backdrop-blur px-2 py-1 rounded-full flex gap-1 items-center shadow-sm">
                     <div className="w-1 h-3 bg-ios-blue rounded-full animate-pulse"></div>
                     <div className="w-1 h-5 bg-ios-blue rounded-full animate-pulse delay-75"></div>
                     <div className="w-1 h-3 bg-ios-blue rounded-full animate-pulse"></div>
                 </div>
             )}
        </div>
      </div>

      {/* State Label */}
      <div className="mt-8 flex items-center gap-2 px-5 py-2 bg-white/60 backdrop-blur-md rounded-full shadow-sm border border-white/50">
        {isSpeaking ? (
          <>
            <Volume2 className="w-4 h-4 text-ios-blue animate-pulse" />
            <span className="text-sm font-semibold text-ios-text">考官正在说话...</span>
          </>
        ) : isListening ? (
          <>
             <Mic className="w-4 h-4 text-red-500 animate-pulse" />
             <span className="text-sm font-semibold text-ios-text">正在聆听中...</span>
          </>
        ) : (
          <span className="text-sm text-ios-subtext font-medium">等待开始...</span>
        )}
      </div>
    </div>
  );
};

export default Avatar;