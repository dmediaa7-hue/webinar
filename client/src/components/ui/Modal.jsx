import React, { useEffect } from 'react';

export default function Modal({
  isOpen,
  onClose,
  title = '',
  children,
  size = 'md'
}) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-3xl'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      <div
        className={`relative bg-meeting-surface border border-meeting-border rounded-xl shadow-2xl w-full ${sizes[size]} animate-pop-in max-h-[92vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-meeting-border">
            <h2 className="text-base sm:text-lg font-semibold">{title}</h2>
            <button
              onClick={onClose}
              className="icon-btn text-gray-400 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
        <div className="p-4 sm:p-6 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
