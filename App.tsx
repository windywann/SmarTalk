import React, { useState } from 'react';
import Navigation from './components/Navigation';
import IeltsExam from './features/IeltsExam';
import Shadowing from './features/Shadowing';
import Modal from './components/Modal';
import { AppTab } from './types';

function App() {
  const [currentTab, setCurrentTab] = useState<AppTab>(AppTab.EXAM);
  const [isExamOngoing, setIsExamOngoing] = useState(false);
  const [pendingTab, setPendingTab] = useState<AppTab | null>(null);
  const [showTabConfirm, setShowTabConfirm] = useState(false);

  const handleTabChange = (tab: AppTab) => {
    if (tab === currentTab) return;

    if (isExamOngoing && currentTab === AppTab.EXAM) {
      setPendingTab(tab);
      setShowTabConfirm(true);
    } else {
      setCurrentTab(tab);
    }
  };

  const confirmTabChange = () => {
    if (pendingTab) {
      setCurrentTab(pendingTab);
      setIsExamOngoing(false); // Reset status as component unmounts
      setShowTabConfirm(false);
      setPendingTab(null);
    }
  };

  return (
    <div className="h-screen w-full bg-ios-bg relative overflow-hidden flex flex-col">
      {/* Dynamic Content Area - Centered container for PC readability */}
      <main className="flex-1 overflow-hidden relative w-full">
        <div className="h-full w-full mx-auto max-w-6xl">
           {currentTab === AppTab.EXAM ? (
             <IeltsExam onExamStatusChange={setIsExamOngoing} />
           ) : (
             <Shadowing />
           )}
        </div>
      </main>

      {/* Navigation - Floating Dock Style */}
      <Navigation currentTab={currentTab} onTabChange={handleTabChange} />

      {/* Tab Switch Confirmation Modal */}
      <Modal 
        isOpen={showTabConfirm}
        title="退出考试?"
        message="您还未完成本次考试，中途退出本次考试记录将会清空，确认要退出吗？"
        confirmText="退出"
        isDanger={true}
        onConfirm={confirmTabChange}
        onCancel={() => setShowTabConfirm(false)}
      />
    </div>
  );
}

export default App;