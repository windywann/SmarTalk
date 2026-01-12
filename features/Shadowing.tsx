import React, { useState } from 'react';
import { Play, Pause, Mic, CheckCircle, RotateCcw } from 'lucide-react';
import { MOCK_SHADOWING_DATA } from '../constants';
import { ShadowingMaterial } from '../types';
import Button from '../components/Button';

const Shadowing: React.FC = () => {
  const [selectedMaterial, setSelectedMaterial] = useState<ShadowingMaterial | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  const togglePlayback = () => {
    setIsPlaying(!isPlaying);
    if (isRecording) setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      setTimeout(() => {
        setScore(Math.floor(Math.random() * (95 - 70 + 1) + 70));
      }, 500);
    } else {
      setIsRecording(true);
      setIsPlaying(false);
      setScore(null);
    }
  };

  // Helper to translate difficulty for display
  const getDifficultyLabel = (diff: string) => {
      switch(diff) {
          case 'Easy': return '简单';
          case 'Medium': return '中等';
          case 'Hard': return '困难';
          default: return diff;
      }
  };

  const getDifficultyColor = (diff: string) => {
    switch(diff) {
        case 'Easy': return 'bg-green-100 text-green-700';
        case 'Medium': return 'bg-yellow-100 text-yellow-700';
        case 'Hard': return 'bg-red-100 text-red-700';
        default: return 'bg-slate-100 text-slate-700';
    }
};

  if (selectedMaterial) {
    return (
      <div className="flex flex-col h-full bg-white md:bg-transparent animate-fade-in relative">
        {/* PC: Centered Card */}
        <div className="md:max-w-3xl md:mx-auto md:w-full md:mt-10 md:bg-white md:rounded-[2.5rem] md:shadow-ios md:border md:border-white/50 md:overflow-hidden flex flex-col h-full md:h-auto">
            
            {/* Header */}
            <div className="px-8 py-6 border-b border-ios-divider flex items-center justify-between bg-white/50 backdrop-blur-sm sticky top-0 z-10">
            <button onClick={() => {
                setSelectedMaterial(null);
                setScore(null);
                setIsPlaying(false);
                setIsRecording(false);
            }} className="flex items-center gap-1 text-ios-blue font-semibold hover:opacity-70 transition-opacity">
                <span className="text-xl">‹</span> 返回列表
            </button>
            <span className="text-xs font-bold uppercase tracking-widest text-ios-subtext bg-slate-100 px-3 py-1 rounded-full">练习模式</span>
            </div>

            {/* Content Area */}
            <div className="flex-1 p-8 lg:p-12 flex flex-col justify-center items-center space-y-10">
            
            <div className="text-center space-y-3">
                <span className={`px-4 py-1.5 rounded-full text-xs font-bold tracking-wide ${getDifficultyColor(selectedMaterial.difficulty)}`}>
                {getDifficultyLabel(selectedMaterial.difficulty)}
                </span>
                <h2 className="text-3xl lg:text-4xl font-bold text-ios-text tracking-tight">{selectedMaterial.title}</h2>
            </div>

            {/* Visualizer Simulation */}
            <div className="w-full h-40 bg-slate-50 rounded-3xl flex items-center justify-center gap-1.5 overflow-hidden relative border border-slate-100 shadow-inner">
                {(isPlaying || isRecording) ? (
                    Array.from({ length: 30 }).map((_, i) => (
                        <div 
                            key={i} 
                            className={`w-2 rounded-full transition-all duration-150 ${isRecording ? 'bg-red-400' : 'bg-ios-blue'}`}
                            style={{ 
                                height: `${Math.random() * 60 + 20}%`,
                                animation: `pulse-ring ${Math.random() * 0.5 + 0.2}s infinite`
                            }} 
                        />
                    ))
                ) : (
                    <div className="w-full h-1 bg-slate-200 mx-10 rounded-full"></div>
                )}
                
                {/* Score Overlay */}
                {score && !isRecording && !isPlaying && (
                    <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center animate-fade-in z-10">
                        <span className="text-sm text-ios-subtext font-semibold uppercase tracking-wide">匹配度得分</span>
                        <div className="flex items-baseline gap-1">
                             <span className="text-7xl font-bold text-ios-blue tracking-tighter">{score}</span>
                             <span className="text-2xl text-slate-400">%</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Text Display */}
            <p className="text-2xl lg:text-3xl text-center leading-relaxed text-slate-700 font-medium max-w-2xl">
                "{selectedMaterial.text}"
            </p>
            </div>

            {/* Controls */}
            <div className="bg-slate-50/80 p-10 md:bg-white md:border-t md:border-ios-divider">
            <div className="flex items-center justify-center gap-10">
                <Button 
                    variant="secondary" 
                    onClick={togglePlayback}
                    className="w-16 h-16 rounded-full !p-0 flex items-center justify-center border-0 shadow-ios hover:shadow-ios-hover bg-white"
                    title="播放原音"
                >
                    {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="ml-1" />}
                </Button>

                <Button 
                    variant="primary" 
                    onClick={toggleRecording}
                    className={`w-24 h-24 rounded-full !p-0 flex items-center justify-center shadow-lg transition-all ${isRecording ? 'bg-red-500 ring-4 ring-red-200 shadow-red-500/30' : 'shadow-ios-blue/40'}`}
                    title="开始录音"
                >
                    {isRecording ? <CheckCircle size={40} /> : <Mic size={40} />}
                </Button>

                <Button 
                    variant="ghost" 
                    onClick={() => setScore(null)}
                    className="w-16 h-16 rounded-full !p-0 flex items-center justify-center text-slate-400 hover:bg-slate-100"
                    title="重置"
                >
                    <RotateCcw size={24} />
                </Button>
            </div>
            <div className="mt-8 text-center text-ios-subtext text-sm font-medium">
                {isRecording ? "正在录入你的声音..." : isPlaying ? "请仔细听原音..." : "先听后读，模仿语调"}
            </div>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 lg:p-12 h-full overflow-y-auto no-scrollbar pb-32 animate-fade-in max-w-6xl mx-auto">
      <div className="mb-10 text-center md:text-left">
        <h1 className="text-4xl font-bold text-ios-text mb-3 tracking-tight">影子跟读</h1>
        <p className="text-ios-subtext text-lg">模仿母语者发音，提升语调自然度。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {MOCK_SHADOWING_DATA.map((item) => (
          <div 
            key={item.id} 
            onClick={() => setSelectedMaterial(item)}
            className="group bg-white p-6 rounded-[2rem] shadow-ios hover:shadow-ios-hover border border-white/50 active:scale-[0.98] transition-all duration-300 cursor-pointer flex flex-col h-64 justify-between"
          >
            <div>
                <div className="flex justify-between items-start mb-4">
                <span className="text-[10px] font-bold text-ios-blue bg-blue-50 px-3 py-1 rounded-full uppercase tracking-wider border border-blue-100">
                    {item.category}
                </span>
                <span className="text-xs text-ios-subtext font-semibold bg-slate-50 px-2 py-1 rounded-lg">{item.duration}</span>
                </div>
                <h3 className="text-xl font-bold text-ios-text mb-2 group-hover:text-ios-blue transition-colors line-clamp-2 leading-tight">
                    {item.title}
                </h3>
                <p className="text-sm text-slate-500 line-clamp-3 leading-relaxed">{item.text}</p>
            </div>
            
            <div className="flex items-center gap-2 mt-4">
                 <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                     <div className="h-full bg-ios-blue w-0 group-hover:w-2/3 transition-all duration-700 ease-out"></div>
                 </div>
                 <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-ios-blue opacity-0 group-hover:opacity-100 transition-all transform translate-x-[-10px] group-hover:translate-x-0">
                     <Play size={12} fill="currentColor" />
                 </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Shadowing;