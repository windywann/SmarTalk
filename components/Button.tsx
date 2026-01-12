import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  isLoading?: boolean;
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  isLoading = false, 
  className = '', 
  disabled,
  ...props 
}) => {
  // Apple style: Slightly more rounded, subtle shadows, clean typography
  const baseStyles = "px-6 py-3 rounded-full font-medium text-[15px] tracking-tight transition-all duration-200 transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2";
  
  const variants = {
    primary: "bg-ios-blue text-white shadow-lg shadow-ios-blue/25 hover:brightness-105",
    secondary: "bg-white text-ios-text border border-ios-divider shadow-sm hover:bg-slate-50",
    danger: "bg-red-500 text-white shadow-lg shadow-red-500/25 hover:bg-red-600",
    ghost: "bg-transparent text-ios-text hover:bg-slate-100"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
      ) : children}
    </button>
  );
};

export default Button;