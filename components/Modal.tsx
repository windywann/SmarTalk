import React from 'react';
import Button from './Button';

interface ModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  onConfirm,
  onCancel,
  isDanger = false
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-opacity"
        onClick={onCancel}
      ></div>

      {/* Modal Card */}
      <div className="relative bg-white/90 backdrop-blur-xl rounded-[1.5rem] shadow-2xl max-w-sm w-full p-6 text-center border border-white/50 transform transition-all scale-100">
        <h3 className="text-xl font-bold text-ios-text mb-2 tracking-tight">
          {title}
        </h3>
        <p className="text-ios-subtext text-[15px] leading-relaxed mb-8">
          {message}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Button 
            variant="secondary" 
            onClick={onCancel}
            className="!py-2.5 !text-sm"
          >
            {cancelText}
          </Button>
          <Button 
            variant={isDanger ? "danger" : "primary"} 
            onClick={onConfirm}
             className="!py-2.5 !text-sm shadow-none"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Modal;